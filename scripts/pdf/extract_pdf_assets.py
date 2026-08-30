#!/usr/bin/env python3
import argparse, json, os, sys, hashlib, re
from pathlib import Path
try:
    import fitz
except Exception as e:
    print(json.dumps({'available': False, 'reason': f'PyMuPDF unavailable: {e}'})); sys.exit(0)
try:
    import pdfplumber
except Exception:
    pdfplumber=None
try:
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    DOCLING=True
except Exception:
    DOCLING=False
if os.getenv('MYAI_CFO_ENABLE_HEAVY_EXTRACTORS','')!='1':
    DOCLING=False

def clean_num(x):
    if x is None:return None
    s=str(x).replace('\xa0',' ').strip()
    neg=('(' in s and ')' in s) or s.startswith('-')
    s=s.replace(',','').replace('(','').replace(')','')
    unit=''
    if re.search(r'(?i)crore',s): unit='crore'
    elif re.search(r'(?i)lakh',s): unit='lakh'
    elif re.search(r'(?i)million|mn',s): unit='million'
    elif re.search(r'(?i)billion|bn',s): unit='billion'
    s=re.sub(r'[^0-9.\-]','',s)
    try:n=float(s)
    except:return None
    if neg and n>0:n=-n
    return n,unit

def scale_factor(unit):
    low=str(unit or '').lower()
    scale=next((k for k in ('crore','lakh','million','billion','thousand') if k in low),None)
    return {'crore':1e7,'lakh':1e5,'million':1e6,'billion':1e9,'thousand':1e3}.get(scale,1)

def normalized(n,unit):
    if n is None:return None
    return n

def detect_doc_year(text, path=None):
    patterns=[r'document fiscal year\s*[:\-]\s*(20\d{2})',r'fiscal year ended December 31,\s*(20\d{2})',r'year ended 31st March,\s*(20\d{2})',r'for the fiscal year ended .*?(20\d{2})']
    for p in patterns:
        m=re.search(p,text,re.I)
        if m:return m.group(1)
    return None

def parse_label_value(lines, labels, year_idx=0):
    """Extract the year_idx-th numeric value associated with a labeled financial row.
    Supports same-line values and split label/value rows, including single-year statements.
    Never assumes that small values are note references.
    """
    for i,line in enumerate(lines):
        low=line.lower().strip()
        if not any(low==lab or low.startswith(lab+" ") or low.startswith(lab+":") for lab in labels):
            continue
        candidates=[]
        def collect(item):
            tokens=re.findall(r'(?<!\d)(?:\(?-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\)?|\(?-?\d{1,}(?:\.\d+)?\)?)(?!\d)', item)
            for tok in tokens:
                if re.fullmatch(r'20\d{2}', re.sub(r'[^0-9]','',tok)): continue
                parsed=clean_num(tok)
                if parsed is not None: candidates.append((parsed[0],parsed[1],tok))
        collect(line)
        if len(candidates) <= year_idx:
            for j in range(i+1,min(len(lines),i+5)):
                item=lines[j].strip()
                if not item: continue
                # Stop before another labeled financial concept.
                if any(item.lower()==lab or item.lower().startswith(lab+" ") or item.lower().startswith(lab+":") for lab in labels if lab):
                    break
                collect(item)
                if len(candidates)>year_idx: break
        if len(candidates)>year_idx:
            return candidates[year_idx]
    return None


def _row_number(lines, idx, stop_terms=None):
    """Return a number attached to this label row, normally on the next line.

    Deliberately examine only the label line and its immediate value line. Scanning
    several rows ahead can silently assign Current Assets to Inventory, etc.
    """
    num_re=r'^\(?-?[\d,]+(?:\.\d+)?\)?$'
    token_re=r'\(?-?[\d,]+(?:\.\d+)?\)?'
    def parse_line(txt):
        t=str(txt).strip()
        if not re.fullmatch(num_re,t):
            return None
        m=re.fullmatch(token_re,t)
        if not m:return None
        parsed=clean_num(m.group(0))
        return (parsed[0],parsed[1],m.group(0)) if parsed is not None else None
    direct=parse_line(lines[idx])
    if direct:return direct
    if idx+1 < len(lines):
        return parse_line(lines[idx+1])
    return None

def structured_facts(text_by_page, doc_year, unit_hint):
    """Extract comparative financial rows using the nearest Fiscal Year heading.

    Each financial row is bound to the most recent explicit Fiscal Year on the page,
    rather than applying the document's maximum year to every comparative value.
    """
    parts=str(unit_hint or 'units').split()
    currency_hint=parts[0] if parts and len(parts[0])==3 and parts[0].isalpha() else None
    scale_hint=' '.join(parts[1:]) if len(parts)>1 else 'units'
    specs={
      'income':[
        ('revenue',['revenue from operations','total revenues','total revenue','revenue']),
        ('cogs',['cost of goods sold','cost of sales','cogs']),
        ('gross_profit',['gross profit']),
        ('operating_income',['operating income','income from operations','operating profit']),
        ('ebitda',['ebitda']),
        ('interest_expense',['interest expense','finance costs','finance cost']),
        ('net_income',['net income','profit for the year','net profit'])],
      'balance':[
        ('cash',['cash and cash equivalents','cash equivalents','cash']),
        ('current_assets',['total current assets','current assets']),
        ('receivables',['trade receivables','accounts receivable','receivables']),
        ('inventory',['inventories','inventory']),
        ('assets',['total assets']),
        ('current_liabilities',['total current liabilities','current liabilities']),
        ('payables',['trade payables','accounts payable','payables']),
        ('liabilities',['total liabilities']),
        ('current_debt',['current portion of debt and finance leases']),('long_term_debt',['debt and finance leases, net of current portion','long-term debt']),('debt',['total debt','total borrowings'])],
      'cashflow':[
        ('operating_cash_flow',['net cash flow from operating activities','cash flow from operating activities','operating cash flow']),
        ('capex',['capital expenditures','capital expenditure','capex','purchase of property']),
        ('depreciation_amortization',['depreciation and amortization','depreciation & amortization','depreciation','amortization'])]
    }
    facts=[]
    for page_no,text in text_by_page:
        lines=[x.replace('\xa0',' ').strip() for x in text.splitlines() if x.strip()]
        current_ctx=None
        current_year=str(doc_year or '')
        for idx,line in enumerate(lines):
            fy=re.search(r'\bfiscal\s+year\s+(20\d{2})\b', line, re.I)
            if fy:
                current_year=fy.group(1)
            # Also recognize statement headings as context switches.
            low=line.lower()
            if re.search(r'^(?:statement of profit and loss|statement of operations|income statement|profit and loss|consolidated statements? of operations)\b',low): current_ctx='income'; continue
            if re.search(r'^(?:consolidated\s+)?(?:balance sheets?|statement of financial position)\b',low): current_ctx='balance'; continue
            if re.search(r'^(?:cash flow statement|statement of cash flows|cash flows?)\b',low): current_ctx='cashflow'; continue
            if current_ctx not in specs: continue
            norm=low.rstrip(':').strip()
            for concept,labels in specs[current_ctx]:
                matched=any(norm==lab or norm.startswith(lab+' ') or norm.startswith(lab+':') for lab in labels)
                if not matched: continue
                got=_row_number(lines,idx, [lab for _, labs in specs[current_ctx] for lab in labs])
                if not got: continue
                n,u,raw=got
                value=normalized(n,u or unit_hint)
                absolute_value=value*scale_factor(u or unit_hint) if value is not None else None
                facts.append({'concept':concept,'value':raw,'normalizedValue':value,'absoluteValue':absolute_value,'unit':unit_hint,'scale':scale_hint,'currency':currency_hint,'sourceUnitText':unit_hint,'fiscalYear':current_year,'page':page_no,'evidenceText':f'{line} {raw}'[:1800],'systemVerified':False,'confidence':0.99,'extractionMethod':'statement-row-structured','statement':current_ctx})
                break
    out=[]; seen=set()
    for f in facts:
        k=(f['concept'],str(f.get('fiscalYear') or ''),round(float(f['normalizedValue']),6) if f.get('normalizedValue') is not None else None)
        if k in seen: continue
        seen.add(k); out.append(f)
    return out


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--output',required=True);ap.add_argument('--assets',required=True);a=ap.parse_args();os.makedirs(a.assets,exist_ok=True)
    doc=fitz.open(a.input);page_text=[]
    manifest={'available':True,'pages':[],'images':[],'pageSnapshots':[],'tables':[],'structuredFacts':[],'method':'docling-first-pdf' if DOCLING else 'pdf-structured-fallback','version':'2.1'};seen_img=set()
    
    full_preview='\n'.join((p.get_text('text') or '') for p in doc[:25])
    munit=re.search(r'(?:all\s+amounts?|amounts?|figures?|values?)\s+(?:are\s+)?(?:stated\s+)?(?:in|denominated\s+in)\s+\(?\s*(INR|USD|GBP|EUR|JPY|CNY|CAD|AUD|SGD|HKD|AED|IDR|ZAR|BRL|MXN|SAR|CHF|NOK|SEK|DKK|NZD)\s*(crore|million|billion|thousand|lakh|mn|bn|m|k)?',full_preview,re.I) or re.search(r'\b(INR|USD|GBP|EUR|JPY|CNY|CAD|AUD|SGD|HKD|AED|IDR|ZAR|BRL|MXN|SAR|CHF|NOK|SEK|DKK|NZD)\s*(?:\(|-)?\s*(crore|million|billion|thousand|lakh|mn|bn|m|k)?',full_preview,re.I)
    currency_hint=munit.group(1).upper() if munit else ('INR' if re.search(r'\bin\s+crore\b|\bI\s+in\s+crore\b',full_preview,re.I) else None)
    scale_hint=({'mn':'million','bn':'billion','m':'million','k':'thousand'}.get((munit.group(2) or '').lower(),munit.group(2) or 'units') if munit else ('crore' if re.search(r'\bin\s+crore\b|\bI\s+in\s+crore\b',full_preview,re.I) else 'units'))
    unit_hint=f'{currency_hint} {scale_hint}' if currency_hint and scale_hint!='units' else (currency_hint or 'units')
    for pno,page in enumerate(doc,start=1):
        txt=page.get_text('text') or '';page_text.append((pno,txt));pdata={'page':pno,'width':page.rect.width,'height':page.rect.height,'imageCount':0,'tableCount':0}
        try:imgs=page.get_images(full=True)
        except Exception:imgs=[]
        pdata['imageCount']=len(imgs)
        for idx,img in enumerate(imgs,start=1):
            try:
                pix=fitz.Pixmap(doc,img[0]);
                if pix.alpha:pix=fitz.Pixmap(fitz.csRGB,pix)
                raw=bytes(pix.samples);digest=hashlib.sha256(raw).hexdigest()[:16]
                if (img[0],digest) in seen_img:continue
                seen_img.add((img[0],digest));name=f'page-{pno:04d}-image-{idx:03d}-{digest}.png';path=os.path.join(a.assets,name);pix.save(path);manifest['images'].append({'page':pno,'index':idx,'xref':img[0],'width':pix.width,'height':pix.height,'path':os.path.relpath(path,os.path.dirname(a.output)).replace('\\','/')})
            except Exception:pass
        if not DOCLING and any(k in txt.lower() for k in ['consolidated statement','balance sheet','statement of operations','income statement','cash flows','total assets','revenue from operations','total revenues']):
            try:
                tf=page.find_tables(); tables=tf.tables if tf else []
                for ti,tbl in enumerate(tables or [],start=1):
                    rows=[[str(c or '').replace('\n',' ').strip() for c in r] for r in tbl.extract() if any(str(c or '').strip() for c in r)]
                    if rows:
                        mx=max(len(r) for r in rows)
                        flat_years=[]
                        for r in rows[:6]: flat_years.extend(int(x) for x in re.findall(r'(?<!\d)(20\d{2})(?!\d)',' '.join(r)))
                        table_years=list(dict.fromkeys(flat_years))[:4] or manifest.get('comparativeFiscalYears',[])[:max(0,mx-1)]
                        headers=[]
                        if table_years and mx==len(table_years)+1:
                            headers=['Line item']+[f'FY{y}' for y in table_years]
                        elif rows and any(re.search(r'20\d{2}',c) for c in rows[0]):
                            headers=rows[0]
                        manifest['tables'].append({'page':pno,'index':ti,'title':f'Table {ti}','rows':len(rows),'columns':mx,'headers':headers,'fiscalYears':table_years,'rowsData':rows,'tsv':'\n'.join('\t'.join(r+['']*(mx-len(r))) for r in rows)})
                        pdata['tableCount']+=1
            except Exception:pass
        # Preserve a visual snapshot for every PDF page, not only pages that happened
        # to contain embedded images/tables. This is the authoritative page-evidence
        # layer and lets reviewers inspect the complete source in order.
        try:
            pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False);name=f'page-{pno:04d}-snapshot.png';path=os.path.join(a.assets,name);pix.save(path);manifest['pageSnapshots'].append({'page':pno,'width':pix.width,'height':pix.height,'scale':1.5,'path':os.path.relpath(path,os.path.dirname(a.output)).replace('\\','/')})
        except Exception:pass
        manifest['pages'].append(pdata)
    full='\n'.join(t for _,t in page_text)
    filename_year=None
    try:
        # Annual filing/report filenames can encode different year-end dates, e.g.
        # tsla-20251231.htm or msft-20250630.htm. Any valid YYYYMMDD in the filename
        # is stronger period evidence than incidental years found in the filing text.
        matches=list(re.finditer(r'(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)', os.path.basename(a.input)))
        for m in reversed(matches):
            year,month,day=int(m.group(1)),int(m.group(2)),int(m.group(3))
            if month>=1 and day>=1:
                filename_year=year; break
    except Exception: filename_year=None
    if not filename_year: manifest['documentFiscalYear']=detect_doc_year(full,a.input)
    manifest['documentUnit']=unit_hint; manifest['documentCurrency']=currency_hint; manifest['documentScale']=scale_hint
    if filename_year: manifest['documentFiscalYear']=filename_year
    years=[]
    for line in full.splitlines()[:160]:
        hdr=[int(x) for x in re.findall(r'(?<!\d)(20\d{2})(?!\d)',line)]
        if 2 <= len(set(hdr)) <= 4:
            years.extend(hdr)
    if not years:
        years=[int(x) for x in re.findall(r'(?<!\d)(20\d{2})(?!\d)',full[:12000])][:4]
    manifest['comparativeFiscalYears']=list(dict.fromkeys(years))
    manifest['structuredFacts']=structured_facts(page_text,manifest['documentFiscalYear'],unit_hint)
    # Docling is attempted when installed, but the deterministic statement path remains the safety gate.
    if DOCLING:
        try:
            opts=PdfPipelineOptions(do_table_structure=True); opts.table_structure_options.mode=TableFormerMode.ACCURATE
            conv=DocumentConverter(format_options={'pdf': PdfFormatOption(pipeline_options=opts)})
            result=conv.convert(a.input); md=result.document.export_to_markdown(); manifest['doclingText']=md;manifest['doclingAvailable']=True
            for ti,table in enumerate(getattr(result.document,'tables',[]) or [],start=1):
                try:
                    df=table.export_to_dataframe(doc=result.document)
                    rows=[[str(v).strip() for v in row] for row in df.fillna('').astype(str).values.tolist()]
                    cols=[str(c) for c in list(df.columns)]
                    grid=[cols]+rows if cols else rows
                    mx=max((len(r) for r in grid),default=0)
                    prov=getattr(table,'prov',None) or []
                    page_no=getattr(prov[0],'page_no',None) if prov else None
                    tys=[]
                    for r in grid[:8]: tys.extend(int(x) for x in re.findall(r'(?<!\d)(20\d{2})(?!\d)',' '.join(r)))
                    table_years=list(dict.fromkeys(tys))[:4] or manifest.get('comparativeFiscalYears',[])[:max(0,mx-1)]
                    headers=cols or (['Line item']+[f'FY{y}' for y in table_years] if table_years and mx==len(table_years)+1 else [])
                    manifest['tables'].append({'page':page_no,'index':ti,'title':f'Docling table {ti}','rows':len(rows),'columns':mx,'headers':headers,'fiscalYears':table_years,'rowsData':grid,'tsv':'\n'.join('\t'.join(r+['']*(mx-len(r))) for r in grid)})
                except Exception as table_err:
                    manifest.setdefault('tableErrors',[]).append(str(table_err))
        except Exception as e:manifest['doclingAvailable']=False;manifest['doclingError']=str(e)
    else: manifest['doclingAvailable']=False;manifest['doclingError']='Docling not installed in this environment; deterministic PDF fallback used.'
    manifest['text']=full
    manifest['extractionQuality']={'grade':'high' if manifest['structuredFacts'] else 'medium','docling':manifest['doclingAvailable'],'structuredFactCount':len(manifest['structuredFacts']),'tableCount':len(manifest['tables']),'imageCount':len(manifest['images']),'pageCount':len(manifest['pages']),'comparativeFiscalYears':manifest.get('comparativeFiscalYears',[]),'warning':'Primary financial-statement facts are promoted only from statement pages; narrative/auditor subtotal figures are not promoted as headline revenue.' if manifest['structuredFacts'] else 'No primary statement facts were confidently extracted; do not promote inferred numbers. The document is NOT evidence-ready.'}
    with open(a.output,'w',encoding='utf-8') as f:json.dump(manifest,f,ensure_ascii=False,indent=2)
    print(json.dumps({'available':True,'pages':len(manifest['pages']),'images':len(manifest['images']),'pageSnapshots':len(manifest['pageSnapshots']),'tables':len(manifest['tables']),'structuredFacts':len(manifest['structuredFacts']),'documentFiscalYear':manifest['documentFiscalYear'],'docling':DOCLING}))
if __name__=='__main__':main()
