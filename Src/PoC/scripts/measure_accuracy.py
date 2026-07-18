"""Misura dell'accuratezza dell'agente OWASP contro il golden set (RQ.2).

Uso:
    # con Claude (richiede ANTHROPIC_API_KEY)
    python scripts/measure_accuracy.py --provider anthropic

    # offline, con un modello locale
    python scripts/measure_accuracy.py --provider ollama

Un riscontro atteso e' considerato RILEVATO se l'agente produce un finding sullo
stesso file, entro la tolleranza di righe, la cui categoria o il cui messaggio
contengono le parole chiave della categoria attesa.

Stampa recall, precisione e il tempo di esecuzione (utile anche per RQ.7).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from code_guardian.agents import OwaspScanProfile  # noqa: E402
from code_guardian.context import LocalRepoLoader  # noqa: E402
from code_guardian.graph import AgentGraph  # noqa: E402
from code_guardian.llm import build_provider  # noqa: E402
from code_guardian.models import SEVERITY_ORDER, ContextRef  # noqa: E402

KEYWORDS = {
    "sql injection": ("sql", "injection"),
    "xss": ("xss", "cross-site", "innerhtml"),
    "segreto in chiaro": ("segreto", "secret", "api key", "hardcoded", "chiave"),
    "crittografia insicura": ("md5", "sha1", "cripto", "crypto", "hash"),
}


def _matches(finding, atteso, tol: int) -> bool:
    if finding.location.file != atteso["file"]:
        return False
    if abs(finding.location.start_line - atteso["line"]) > tol:
        return False
    haystack = f"{finding.category} {finding.message}".lower()
    keys = KEYWORDS.get(atteso["categoria"], (atteso["categoria"],))
    return any(k in haystack for k in keys)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="anthropic")
    ap.add_argument("--repo", default=str(ROOT / "examples" / "sample_repo"))
    ap.add_argument("--golden", default=str(ROOT / "examples" / "golden_set.json"))
    ap.add_argument("--soglia", type=float, default=0.85, help="soglia di accuratezza (RQ.2)")
    args = ap.parse_args()

    golden = json.loads(Path(args.golden).read_text(encoding="utf-8"))
    attesi, tol = golden["attesi"], golden.get("tolleranza_righe", 2)

    graph = AgentGraph(LocalRepoLoader(args.repo), OwaspScanProfile(), build_provider(args.provider))
    report = graph.run(ContextRef(repo_url=args.repo))

    if report.status == "fallito":
        print(f"Esecuzione fallita ({report.error.type}): {report.error.message}")
        return 2

    findings = list(report.findings)
    rilevati, mancanti = [], []
    for a in attesi:
        hit = next((f for f in findings if _matches(f, a, tol)), None)
        (rilevati if hit else mancanti).append((a, hit))

    veri_positivi = len(rilevati)
    recall = veri_positivi / len(attesi) if attesi else 0.0
    precisione = veri_positivi / len(findings) if findings else 0.0

    print(f"Durata            : {report.duration_ms} ms  (limite RQ.7: 45000 ms)")
    print(f"Riscontri prodotti: {len(findings)}")
    print(f"Attesi rilevati   : {veri_positivi}/{len(attesi)}")
    print(f"Recall            : {recall:.0%}")
    print(f"Precisione        : {precisione:.0%}")

    for a, hit in rilevati:
        sev_ok = SEVERITY_ORDER.index(hit.severity) >= SEVERITY_ORDER.index(a["severita_minima"])
        flag = "" if sev_ok else "  [gravita' sottostimata]"
        print(f"  OK   {a['file']}:{a['line']}  {a['categoria']}{flag}")
    for a, _ in mancanti:
        print(f"  MISS {a['file']}:{a['line']}  {a['categoria']}")

    entro_tempo = report.duration_ms < 45_000
    esito = recall >= args.soglia and entro_tempo
    print(f"\nEsito: {'SUPERATO' if esito else 'NON SUPERATO'} (soglia {args.soglia:.0%})")
    return 0 if esito else 1


if __name__ == "__main__":
    sys.exit(main())
