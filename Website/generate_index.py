import os
from datetime import datetime

def find_correct_path(base_path, target_name):
    """
    Cerca una sottocartella che inizi con target_name (es. 'intern') 
    gestendo maiuscole/minuscole senza modificare il nome originale.
    """
    if not os.path.exists(base_path):
        return None
    for entry in os.listdir(base_path):
        if entry.lower().startswith(target_name.lower()):
            return entry
    return None

def generate_links(verbali_root, folder_search, tipo_verbale):
    """
    Scansiona i PDF e genera i tag HTML con i percorsi corretti.
    """
    # Trova il nome reale della cartella (es. 'Interno', 'Interni', 'Esterno'...)
    real_folder_name = find_correct_path(verbali_root, folder_search)
    
    if not real_folder_name:
        print(f"DEBUG: Nessuna cartella trovata per {tipo_verbale} (cercavo: {folder_search})")
        return "<p>Nessun verbale disponibile.</p>"
    
    full_path = os.path.join(verbali_root, real_folder_name)
    
    # Filtra solo i file PDF
    try:
        files = [f for f in os.listdir(full_path) if f.lower().endswith(".pdf")]
    except OSError:
        return "<p>Nessun verbale disponibile.</p>"
    
    if not files:
        return "<p>Nessun verbale disponibile.</p>"
    
    # Ordine cronologico/alfabetico per numerazione n°1, n°2...
    files.sort()
    
    links_list = []
    for index, filename in enumerate(files):
        # IL LINK WEB: deve puntare a Documentazione/Verbali/NomeCartellaReale/file.pdf
        # Non aggiungiamo 's' o altre lettere: usiamo real_folder_name così com'è.
        web_path = f"Documentazione/Verbali/{real_folder_name}/{filename}"
        
        # Pulizia della data per la visualizzazione (es. VI_2026_03_10 -> 2026-03-10)
        date_part = filename.lower().replace(".pdf", "")
        date_part = date_part.replace("vi_", "").replace("ve_", "").replace("_", "-")
        
        numero_verbale = index + 1
        display_name = f"Verbale {tipo_verbale} n°{numero_verbale} - {date_part}"
        
        link_tag = f'<p><a href="{web_path}" target="_blank">{display_name}</a></p>'
        links_list.append(link_tag)
    
    # Invertiamo: l'ultimo verbale (il più recente) appare per primo
    links_list.reverse()
    return "\n      ".join(links_list)

def main():
    # Identifica la cartella dove si trova lo script (Website/)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Percorso dove l'Action copia i file: Website/Documentazione/Verbali/
    verbali_root = os.path.join(current_dir, "Documentazione", "Verbali")
    
    # Genera le liste per i verbali
    # Cerchiamo 'intern' per trovare Interno/Interni e 'estern' per Esterno/Esterni
    html_esterni = generate_links(verbali_root, "estern", "Esterno")
    html_interni = generate_links(verbali_root, "intern", "Interno")
    
    # Percorsi template e index
    template_path = os.path.join(current_dir, "template.html")
    index_path = os.path.join(current_dir, "index.html")

    if not os.path.exists(template_path):
        print(f"ERRORE: Template non trovato in {template_path}")
        return

    # Leggi template e sostituisci i placeholder
    with open(template_path, "r", encoding="utf-8") as f:
        content = f.read()

    data_oggi = datetime.now().strftime("%d-%m-%Y")
    content = content.replace("{{VERBALI_ESTERNI}}", html_esterni)
    content = content.replace("{{VERBALI_INTERNI}}", html_interni)
    content = content.replace("{{DATA_OGGI}}", data_oggi)

    # Scrittura del file finale
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"Generazione completata con successo il {data_oggi}")

if __name__ == "__main__":
    main()