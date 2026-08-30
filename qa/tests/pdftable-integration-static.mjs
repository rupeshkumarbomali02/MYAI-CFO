import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ensemble=fs.readFileSync(path.join(root,'scripts','extraction','document_ensemble.py'),'utf8');
const adapter=fs.readFileSync(path.join(root,'scripts','pdf','pdftable_adapter.py'),'utf8');
const setup=fs.readFileSync(path.join(root,'scripts','setup','setup-pdftable.ps1'),'utf8');
const checks={
  adapterPresent: fs.existsSync(path.join(root,'scripts','pdf','pdftable_adapter.py')),
  setupPresent: fs.existsSync(path.join(root,'scripts','setup','setup-pdftable.ps1')),
  ensembleReference: /pdftable_adapter\.py|run_pdftable/.test(ensemble),
  adapterCli: /--table_structure_model/.test(adapter) && /--output_dir/.test(adapter),
  noMandatoryInstall: !/pip install.*pdftable/i.test(ensemble),
  sourcePinned: /CycloneBoy\/pdf_table/.test(setup),
};
console.log(JSON.stringify(checks,null,2));
process.exit(Object.values(checks).every(Boolean)?0:1);
