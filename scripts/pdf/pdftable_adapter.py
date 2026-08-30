#!/usr/bin/env python3
"""Optional adapter for CycloneBoy/pdf_table (arXiv:2409.05125).

The adapter is intentionally optional and isolated from the deterministic financial
fact path. When `pdftable` is installed it returns table grids/HTML-derived text
that the existing ensemble can use as an additional independent table signal.
Model weights remain external/local; the adapter never downloads anything by itself.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path


def html_to_rows(html_path):
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return []
    soup=BeautifulSoup(Path(html_path).read_text(errors='ignore'), 'html.parser')
    out=[]
    for table in soup.find_all('table'):
        rows=[]
        for tr in table.find_all('tr'):
            cells=[c.get_text(' ', strip=True) for c in tr.find_all(['th','td'])]
            if cells: rows.append(cells)
        if rows: out.append(rows)
    return out


def run(args):
    exe=shutil.which(os.getenv('MYAI_CFO_PDFTABLE_EXE','pdftable'))
    if not exe:
        return {'available':False,'status':'NOT_INSTALLED','reason':'PdfTable CLI not installed; existing ensemble remains authoritative.'}
    output_dir=Path(args.output_dir or tempfile.mkdtemp(prefix='myai-pdftable-'))
    output_dir.mkdir(parents=True,exist_ok=True)
    cmd=[exe,'--output_dir',str(output_dir),'--file_path_or_url',str(args.input),'--pages',args.pages,
         '--lang','en','--detect_model',os.getenv('MYAI_PDFTABLE_DETECT_MODEL','PP-OCRv4'),
         '--recognizer_model',os.getenv('MYAI_PDFTABLE_RECOGNIZER_MODEL','PP-OCRv4'),
         '--table_structure_model',os.getenv('MYAI_PDFTABLE_TABLE_MODEL','MtlTabNet'),
         '--table_structure_task_type',os.getenv('MYAI_PDFTABLE_TABLE_TASK','fin'),
         '--layout_model',os.getenv('MYAI_PDFTABLE_LAYOUT_MODEL','picodet')]
    try:
        cp=subprocess.run(cmd,capture_output=True,text=True,timeout=int(args.timeout),check=False)
    except subprocess.TimeoutExpired:
        return {'available':True,'status':'TIMEOUT','timeoutSec':int(args.timeout),'command':cmd}
    except Exception as e:
        return {'available':True,'status':'ERROR','error':str(e),'command':cmd}
    tables=[]; page_text=[]; outputs=[]
    for p in sorted(output_dir.rglob('*')):
        if p.is_file() and p.suffix.lower() in {'.html','.htm','.csv','.json'}:
            outputs.append(str(p))
    for pstr in outputs:
        p=Path(pstr)
        if p.suffix.lower() in {'.html','.htm'}:
            for idx,rows in enumerate(html_to_rows(p),1):
                mx=max((len(r) for r in rows),default=0)
                norm=[r+['']*(mx-len(r)) for r in rows]
                tables.append({'title':f'PdfTable {p.stem} table {idx}','source':str(p),'rowsData':norm,
                               'rows':len(norm),'columns':mx,'tsv':'\n'.join('\t'.join(r) for r in norm)})
            try: page_text.append(p.read_text(errors='ignore'))
            except Exception: pass
    return {'available':True,'status':'PASS' if cp.returncode==0 else 'NONZERO',
            'returnCode':cp.returncode,'stdout':cp.stdout[-4000:],'stderr':cp.stderr[-4000:],
            'tables':tables,'pages':[{'page':1,'text':'\n'.join(page_text),'extractor':'pdftable'}] if page_text else [],
            'outputFiles':outputs,'config':{'tableModel':os.getenv('MYAI_PDFTABLE_TABLE_MODEL','MtlTabNet'),
                                            'task':os.getenv('MYAI_PDFTABLE_TABLE_TASK','fin')}}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--input',required=True); ap.add_argument('--output_dir',default=''); ap.add_argument('--pages',default='all'); ap.add_argument('--timeout',default=240,type=int); ap.add_argument('--output',required=True)
    args=ap.parse_args(); result=run(args)
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':result.get('status'),'available':result.get('available'),'tableCount':len(result.get('tables',[])),'pageCount':len(result.get('pages',[]))}))
    return 0 if result.get('status') in {'PASS','NOT_INSTALLED','NONZERO','TIMEOUT','ERROR'} else 0
if __name__=='__main__': sys.exit(main())
