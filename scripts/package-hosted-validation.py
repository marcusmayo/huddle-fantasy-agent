"""Build a deterministic source package. Secrets, recordings and state are excluded."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parent.parent
destination=root/'.media-build/hosted-validation.zip'
paths=[root/'package.json',root/'package-lock.json']
for folder,extensions in [('src',{'.js'}),('public',{'.js','.html','.css','.wasm','.gz'}),('scripts',{'.js','.mjs','.cjs'}),('config',{'.json'}),('system',{'.yaml','.yml','.json'})]:
 for p in (root/folder).rglob('*'):
  relative=p.relative_to(root).as_posix()
  if p.is_file() and p.suffix in extensions and not relative.startswith(('scripts/media/','public/assets/')) and not any(x in p.parts for x in ['node_modules','__pycache__']):paths.append(p)
required=[root/'public/vendor/yahoo-clock/worker.min.js',root/'public/vendor/yahoo-clock/eng.traineddata.gz']
if not all(p.exists() for p in required):raise SystemExit('Build clock assets before packaging')
manifest={}
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for p in sorted(set(paths)):
  name=p.relative_to(root).as_posix();body=p.read_bytes()
  if p.suffix in {'.js','.mjs','.cjs','.html','.css','.json'}:body=body.replace(b'\r\n',b'\n')
  manifest[name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  archive.writestr(info,body)
 info=zipfile.ZipInfo('deployment-manifest.json',date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
 archive.writestr(info,json.dumps({'version':1,'files':manifest},sort_keys=True,indent=2))
print(json.dumps({'file':str(destination),'files':len(manifest),'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}))
