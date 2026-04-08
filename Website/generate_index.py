import os
from datetime import datetime

def generate_links(directory, tipo_verbale):
    # Lo script ora si trova in Website/ e cerca Website/Documentazione/
    base_path = os.path.join(os.path.dirname(__file__), directory)
    
    if not os.path.exists(base_path):
        print(f"Attenzione: Cartella non trovata -> {base_path}")
        return ""
    
    # Prende i PDF e li ordina per data (cronologico crescente per numerarli)
    files = [f for f in os.listdir(base_path) if f.lower().endswith(".pdf")]
    files.sort()
    
    links_list = []
    for index, filename in enumerate(files):
        # Il percorso nel link HTML deve essere relativo a index.html
        web_path = f"Documentazione/Verbali/{tipo_verbale}s/{filename}"
        
        # Pulizia nome: toglie estensione e prefissi, mette i trattini nella data
        date_part = filename.lower().replace(".pdf", "").replace("vi_", "").replace("ve_", "").replace("_", "-")
        numero_verbale = index + 1
        display_name = f"Verbale {tipo_verbale} n°{numero_verbale} - {date_part}"
        
        link_tag = f'<p><a href="{web_path}" target="_blank">{display_name}</a></p>'
        links_list.append(link_tag)
    
    # Inverte per avere il più recente in cima
    links_list.reverse()
    return "\n      ".join(links_list)

def main():
    # Percorsi relativi alla cartella Website/
    dir_esterni = "Documentazione/Verbali/Esterni"
    dir_interni = "Documentazione/Verbali/Interni"
    
    html_esterni = generate_links(dir_esterni, "Esterno")
    html_interni = generate_links(dir_interni, "Interno")
    
    current_dir = os.path.dirname(__file__)
    template_path = os.path.join(current_dir, "template.html")
    index_path = os.path.join(current_dir, "index.html")

    with open(template_path, "r", encoding="utf-8") as f:
        template_content = f.read()

    data_oggi = datetime.now().strftime("%d-%m-%Y")
    output = template_content.replace("{{VERBALI_ESTERNI}}", html_esterni)
    output = template_content.replace("{{VERBALI_INTERNI}}", html_interni)
    output = output.replace("{{DATA_OGGI}}", data_oggi)

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(output)
    
    print("Successo: index.html generato dopo la copia dei file.")

if __name__ == "__main__":
    main()