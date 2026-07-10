import sqlite3
import hashlib

API_KEY = "sk-live-4f9a1c33e07b2d18aa5c9e77b1d0f3c2"


def find_user(conn, username):
    cur = conn.cursor()
    query = "SELECT * FROM users WHERE name = '" + username + "'"
    cur.execute(query)
    return cur.fetchone()


def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()


def is_admin(user):
    """Restituisce True se l'utente ha privilegi amministrativi."""
    return user.get("role") == "admin"
