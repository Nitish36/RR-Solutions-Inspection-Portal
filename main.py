import sqlite3
from flask import Flask, render_template, request, jsonify, make_response, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import os
from datetime import datetime
import csv
import io
import qrcode
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials

app = Flask(__name__, template_folder='template')
app.config['SECRET_KEY'] = 'RR_SOLUTIONS_SECRET_KEY'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///rr_solutions.db'
app.config['UPLOAD_FOLDER'] = 'static/pdfs'
db = SQLAlchemy(app)
login_manager = LoginManager(app)

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])



# --- DATABASE MODELS ---


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    certs = db.relationship('Certificate', backref='owner', lazy=True)


class Certificate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    asset_id = db.Column(db.String(50), unique=True, nullable=False)
    form_type = db.Column(db.String(50))
    equipment = db.Column(db.String(100))
    site = db.Column(db.String(100))
    inspection_date = db.Column(db.String(20))
    expiry_date = db.Column(db.String(20))
    status = db.Column(db.String(20), default="Valid")
    pdf_path = db.Column(db.String(200)) 
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

with app.app_context():
    db.create_all()


def sync_to_google_sheets():
    try:
        print("--- Starting Sync ---")

        # 1. Setup Google Credentials
        scope = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
        creds = Credentials.from_service_account_file("cred/diamond-analysis-ac6758ca1ace.json", scopes=scope)
        client = gspread.authorize(creds)
        print("Authenticated with Google.")

        # 2. Open your sheet
        sheet = client.open("RR_Solutions_Master_Data").sheet1
        print("Successfully opened Google Sheet.")

        # 3. Pull ALL data from SQLite
        with app.app_context():
            # This query gets the username of the person the certificate was assigned to
            results = db.session.query(
                User.username,
                Certificate.asset_id,
                Certificate.equipment,
                Certificate.site,
                Certificate.inspection_date,
                Certificate.expiry_date,
                Certificate.status,
                Certificate.pdf_path
            ).join(User, Certificate.user_id == User.id).all() # This connects Cert owner to User table

        print(f"Fetched {len(results)} records from SQLite.")

        if not results:
            print("No data in database to sync.")
            return

        # 4. Format for Google Sheets
        headers = ["Username", "Asset ID", "Equipment", "Site", "Inspection Date", "Expiry Date", "Status", "Has PDF?"]
        rows = [headers]

        for r in results:
            has_pdf = "Yes" if r.pdf_path else "No"
            # We use r[0], r[1] etc. to ensure we get exactly what the query returned
            rows.append([r[0], r[1], r[2], r[3], r[4], r[5], r[6], has_pdf])
            
        # 5. Overwrite the sheet
        sheet.clear()
        # Using the safer updated syntax
        sheet.update(values=rows, range_name='A1')

        print("--- Sync Complete! Data is now in Google Sheets ---")
        return True

    except gspread.exceptions.SpreadsheetNotFound:
        print("ERROR: Could not find a sheet named 'RR_Solutions_Master_Data'. Make sure the name matches exactly.")
    except Exception as e:
        print(f"CRITICAL ERROR: {str(e)}")
        return False


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- AUTH ROUTES ---


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/register', methods=['POST'])
@login_required  # Now requires a login to even reach this
def register():
    # 1. SECURITY: Only the admin can create new accounts
    if current_user.username != 'admin':
        return jsonify({"status": "error", "message": "Unauthorized: Only admin can create users"}), 403

    data = request.json
    username = data.get('username')
    password = data.get('password')

    if User.query.filter_by(username=username).first():
        return jsonify({"status": "error", "message": "User already exists"}), 400

    # 2. Create the user with hashed password
    hashed = generate_password_hash(password, method='pbkdf2:sha256')
    new_user = User(username=username, password=hashed)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"status": "success", "message": f"Account for {username} created!"})


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password, data['password']):
        login_user(user, remember=True)
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Invalid Login"}), 401


# --- DASHBOARD & STATS (SQLite Only) ---
@app.route('/api/dashboard_stats')
@login_required
def dashboard_stats():
    user_certs = Certificate.query.filter_by(user_id=current_user.id).all()
    today = datetime.now()
    stats = {"total": len(user_certs), "valid": 0, "soon": 0, "expired": 0}

    for c in user_certs:
        try:
            exp = datetime.strptime(c.expiry_date, '%Y-%m-%d')
            days = (exp - today).days
            if days < 0: stats["expired"] += 1
            elif 0 <= days <= 7: stats["soon"] += 1
            else: stats["valid"] += 1
        except: continue
    return jsonify(stats)


# --- CERTIFICATE CRUD ---
@app.route('/api/add_certificate', methods=['POST'])
@login_required
def add_cert():
    if current_user.username != 'admin':
        return jsonify({"message": "Unauthorized"}), 403

    # 1. Find the client by the username typed in the form
    client_username = request.form.get('name') 
    target_user = User.query.filter_by(username=client_username).first()

    if not target_user:
        return jsonify({"status": "error", "message": f"Client '{client_username}' not found in database"}), 404

    asset_id = request.form.get('id')
    file = request.files.get('pdf_file')
    filename = ""
    if file:
        filename = secure_filename(f"{asset_id}.pdf")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    # 2. Save the certificate to the TARGET USER, not current_user
    new_c = Certificate(
        asset_id=asset_id,
        form_type=request.form.get('form_type'),
        equipment=request.form.get('type'),
        site=request.form.get('site'),
        inspection_date=request.form.get('date'),
        expiry_date=request.form.get('expiry_date'),
        pdf_path=filename,
        user_id=target_user.id, # <--- CHANGE THIS: Use the client's ID
    )

    db.session.add(new_c)
    db.session.commit()

    # 3. Sync to Google Sheets immediately
    sync_to_google_sheets()

    return jsonify({"status": "success"})


@app.route('/api/certificates')
@login_required
def get_certs():
    # We query the database for certificates ONLY where user_id matches the logged-in user
    user_certs = Certificate.query.filter_by(user_id=current_user.id).all()

    # We convert the SQLite objects into a list of dictionaries for JavaScript
    output = []
    for c in user_certs:
        output.append({
            "id": c.asset_id,
            "type": c.equipment,
            "site": c.site,
            "expiry": c.expiry_date,
            "status": c.status,
            "pdf": c.pdf_path # We include the PDF filename so the user can open it
        })
    return jsonify(output)


@app.route('/api/delete_certificate/<asset_id>', methods=['DELETE'])
@login_required
def delete_certificate(asset_id):
    cert = Certificate.query.filter_by(asset_id=asset_id, user_id=current_user.id).first()
    if cert:
        db.session.delete(cert)
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Not found"}), 404

# Search By ID
@app.route('/api/search_asset/<search_query>')
@login_required
def search_asset(search_query):
    # This filters by the Asset ID AND ensures it belongs to the logged-in user
    asset = Certificate.query.filter_by(
        asset_id=search_query, 
        user_id=current_user.id
    ).first()

    if asset:
        return jsonify({
            "status": "success",
            "data": {
                "id": asset.asset_id,
                "type": asset.equipment,
                "site": asset.site,
                "expiry": asset.expiry_date,
                "status": asset.status,
                "pdf": asset.pdf_path
            }
        })
    
    return jsonify({"status": "error", "message": "Asset not found in your inventory"}), 404


# --- RENEWALS & NOTIFICATIONS ---
@app.route('/api/notifications')
@login_required
def get_notifications():
    certs = Certificate.query.filter_by(user_id=current_user.id).all()
    today = datetime.now()
    alerts = []
    for c in certs:
        try:
            exp = datetime.strptime(c.expiry_date, '%Y-%m-%d')
            days = (exp - today).days
            if days == 1: alerts.append({"id": c.asset_id, "msg": "Expires Tomorrow", "type": "urgent"})
            elif 0 < days <= 7: alerts.append({"id": c.asset_id, "msg": f"Expires in {days} days", "type": "warning"})
        except: continue
    return jsonify(alerts)


@app.route('/api/renewals', methods=['GET'])
@login_required
def get_renewals():
    # 1. Connect to the database
    conn = sqlite3.connect('instance/rr_solutions.db')  # Ensure path matches your setup

    # 2. Pull all certificates for the logged-in user into a Pandas DataFrame
    query = f"SELECT asset_id as id, equipment as type, site, expiry_date FROM certificate WHERE user_id = {current_user.id}"
    df = pd.read_sql_query(query, conn)
    conn.close()

    if df.empty:
        return jsonify([])

    # 3. Use Pandas magic to handle dates
    today = pd.to_datetime(datetime.now().date())
    df['expiry_date'] = pd.to_datetime(df['expiry_date'])

    # Calculate days left
    df['days_left'] = (df['expiry_date'] - today).dt.days

    # 4. Filter: Show everything already expired OR expiring within 60 days
    # (Matches your requirement to see the 2026-02-19 items)
    renewals_df = df[df['days_left'] <= 60].copy()

    # 5. Sort by most urgent
    renewals_df = renewals_df.sort_values(by='days_left')

    # 6. Convert expiry_date back to string for JSON (since JSON doesn't like Timestamps)
    renewals_df['expiry_date'] = renewals_df['expiry_date'].dt.strftime('%Y-%m-%d')

    # 7. Convert DataFrame to a list of dictionaries for the frontend
    result = renewals_df.to_dict(orient='records')

    return jsonify(result)


# --- CHARTS & PROFILE ---
@app.route('/api/chart_data')
@login_required
def chart_data():
    certs = Certificate.query.filter_by(user_id=current_user.id).all()
    valid = len([c for c in certs if c.status == "Valid"])
    expired = len(certs) - valid
    return jsonify({
        "status_labels": ["Valid", "Expired"],
        "status_values": [valid, expired],
        "type_labels": ["Equipment"], "type_values": [len(certs)]
    })


@app.route('/api/export_csv')
@login_required
def export_csv():
    certs = Certificate.query.filter_by(user_id=current_user.id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Asset ID', 'Equipment', 'Site', 'Expiry'])
    for c in certs:
        writer.writerow([c.asset_id, c.equipment, c.site, c.expiry_date])
    response = make_response(output.getvalue())
    response.headers["Content-Disposition"] = "attachment; filename=report.csv"
    return response


# --- QR & VERIFY ---
@app.route('/generate_qr/<asset_id>')
def generate_qr(asset_id):
    qr = qrcode.make(f"{request.host_url}verify/{asset_id}")
    buf = io.BytesIO()
    qr.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')


@app.route('/verify/<asset_id>')
def verify(asset_id):
    cert = Certificate.query.filter_by(asset_id=asset_id).first()
    if cert:
        return render_template('verify_status.html', data=cert)
    return "Not Found", 404


@app.route('/api/field_upload', methods=['POST'])
@login_required  # THIS ENSURES IT IS PRIVATE
def field_upload():
    asset_id = request.form.get('asset_id')
    file = request.files.get('pdf_file')

    if not file or not asset_id:
        return jsonify({"status": "error", "message": "Missing data"}), 400

    # Find the certificate in SQLite
    cert = Certificate.query.filter_by(asset_id=asset_id).first()

    if cert:
        # Save file to static/pdfs folder
        filename = secure_filename(f"{asset_id}.pdf")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

        # Update the database record
        cert.pdf_path = filename
        db.session.commit()

        return jsonify({"status": "success"})

    return jsonify({"status": "error", "message": "Asset not found"}), 404


@app.route('/api/admin/sync_data')
@login_required
def admin_sync():
    # You can restrict this to only 'admin' user if you want
    if current_user.username != 'admin':
        return jsonify({"message": "Unauthorized"}), 403

    sync_to_google_sheets()
    return jsonify({"status": "success", "message": "Google Sheet Updated!"})


@app.route('/api/check_session')
def check_session():
    if current_user.is_authenticated:
        return jsonify({
            "status": "authenticated", 
            "user": current_user.username
        }), 200
    return jsonify({"status": "unauthenticated"}), 401


@app.route('/api/logout')
@login_required
def logout():
    logout_user()
    return jsonify({"status": "success"})


if __name__ == '__main__':
    app.run(debug=True)