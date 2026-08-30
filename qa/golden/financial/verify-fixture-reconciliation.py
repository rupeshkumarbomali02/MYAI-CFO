#!/usr/bin/env python3
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
EXPECTED=HERE/"expected-facts.json"
PDF=HERE/"financial_integrity_fixture.pdf"

def load(path): return json.loads(Path(path).read_text(encoding="utf-8"))

def verify(ensemble, assets):
    expected=load(EXPECTED)
    merged={}
    for source in (ensemble.get("structuredFacts", []), assets.get("structuredFacts", [])):
        for fact in source:
            merged.setdefault((fact.get("concept"), str(fact.get("fiscalYear") or "")), []).append(fact)
    failures=[]
    for key,val in expected.items():
        concept,year=key.split("|")
        vals=merged.get((concept,year),[])
        if not vals or not any(abs(float(x.get("normalizedValue"))-float(val))<1e-9 for x in vals):
            failures.append({"concept":concept,"year":year,"expected":val})
    return failures

def main():
    ap=argparse.ArgumentParser(description="Run the complete financial golden fixture extraction and reconciliation.")
    ap.add_argument("--ensemble", help="Existing ensemble JSON output")
    ap.add_argument("--assets", help="Existing structured asset JSON output")
    ap.add_argument("--pdf", help="Fixture PDF; defaults to the bundled golden PDF")
    args=ap.parse_args()
    temp_paths=[]
    try:
        if args.ensemble and args.assets:
            ensemble=load(args.ensemble); assets=load(args.assets)
        elif args.ensemble or args.assets:
            ap.error("Provide both --ensemble and --assets, or provide neither and let the wrapper run extraction.")
        else:
            with tempfile.TemporaryDirectory() as td:
                ep=Path(td)/"ensemble.json"; apath=Path(td)/"assets.json"; assets_dir=Path(td)/"assets"; assets_dir.mkdir()
                # Run both production extractors using their documented interfaces.
                subprocess.run([sys.executable,str(ROOT/"scripts/extraction/document_ensemble.py"),"--input",str(args.pdf or PDF),"--output",str(ep)],check=True)
                subprocess.run([sys.executable,str(ROOT/"scripts/pdf/extract_pdf_assets.py"),"--input",str(args.pdf or PDF),"--output",str(apath),"--assets",str(assets_dir)],check=True)
                ensemble=load(ep); assets=load(apath)
        failures=verify(ensemble,assets)
        meta_expected={"documentUnit":"INR million","documentScale":"million","documentCurrency":"INR","documentFiscalYear":2027}
        meta_actual={"documentUnit":ensemble.get("documentUnit") or assets.get("documentUnit"),"documentScale":ensemble.get("documentScale") or assets.get("documentScale"),"documentCurrency":ensemble.get("documentCurrency") or assets.get("documentCurrency"),"documentFiscalYear":int(ensemble.get("documentFiscalYear") or assets.get("documentFiscalYear") or 0)}
        metadata_ok=all(meta_actual.get(k)==v for k,v in meta_expected.items())
        out={"ok":not failures and metadata_ok,"expectedFacts":len(load(EXPECTED)),"ensembleFacts":len(ensemble.get("structuredFacts",[])),"assetFacts":len(assets.get("structuredFacts",[])),"missingOrMismatch":failures,"metadataExpected":meta_expected,"metadataActual":meta_actual,"metadataOk":metadata_ok}
        print(json.dumps(out,indent=2))
        return 0 if out["ok"] else 1
    except subprocess.CalledProcessError as e:
        print(json.dumps({"ok":False,"error":"extractor_failed","returncode":e.returncode},indent=2))
        return e.returncode or 1

if __name__=="__main__": raise SystemExit(main())
