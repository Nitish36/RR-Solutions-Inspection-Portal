from flask import Flask, render_template, request, jsonify, make_response, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import os
from datetime import datetime, timedelta
import csv
import io
import qrcode

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

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- AUTH ROUTES ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"status": "error", "message": "User exists"}), 400
    hashed = generate_password_hash(data['password'], method='pbkdf2:sha256')
    new_user = User(username=data['username'], password=hashed)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"status": "success"})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password, data['password']):
        login_user(user)
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
    asset_id = request.form.get('id')
    file = request.files.get('pdf_file')
    filename = ""
    if file:
        filename = secure_filename(f"{asset_id}.pdf")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    new_c = Certificate(
        asset_id=asset_id,
        form_type=request.form.get('form_type'),
        equipment=request.form.get('type'),
        site=request.form.get('site'),
        inspection_date=request.form.get('date'),
        expiry_date=request.form.get('expiry_date'),
        pdf_path=filename,
        user_id=current_user.id
    )
    db.session.add(new_c)
    db.session.commit()
    return jsonify({"status": "success"})

@app.route('/api/certificates')
@login_required
def get_certs():
    certs = Certificate.query.filter_by(user_id=current_user.id).all()
    return jsonify([{"id": c.asset_id, "type": c.equipment, "site": c.site, "expiry": c.expiry_date, "status": c.status} for c in certs])

@app.route('/api/delete_certificate/<asset_id>', methods=['DELETE'])
@login_required
def delete_certificate(asset_id):
    cert = Certificate.query.filter_by(asset_id=asset_id, user_id=current_user.id).first()
    if cert:
        db.session.delete(cert)
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Not found"}), 404

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

if __name__ == '__main__':
    app.run(debug=True)