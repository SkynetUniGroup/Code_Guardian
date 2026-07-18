# Regole di sviluppo sicuro del team

1. Nessun segreto (API key, password, token) deve comparire nel codice sorgente.
2. Le query SQL devono usare esclusivamente parametri, mai concatenazione di stringhe.
3. Gli hash di password devono usare bcrypt o argon2; MD5 e SHA1 sono vietati.
4. Ogni scrittura nel DOM deve passare da sanitizzazione: `innerHTML` è vietato.
