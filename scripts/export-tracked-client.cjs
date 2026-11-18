const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');

function copyTrackedClient(output) {
  output=path.resolve(output);
  if(fs.existsSync(output))throw Error('Choose a new output directory; existing probes may contain private signing settings.');
  if(output===root||output===path.join(root,'client')||output.startsWith(path.join(root,'client')+path.sep))
    throw Error('Probe output cannot replace client/.');
  const files=cp.execFileSync('git',['ls-files','-z','client/'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  if(!files.length)throw Error('Run inside a clone containing the shared client.');
  cp.execFileSync('git',['diff','--quiet','HEAD','--','client/'],{cwd:root});
  for(const file of files) {
    if(!file.startsWith('client/')||path.isAbsolute(file)||file.split('/').includes('..'))throw Error('Invalid source path.');
    const input=path.join(root,file);
    if(!fs.lstatSync(input).isFile())throw Error('Only regular source files can be exported.');
    const target=path.join(output,file.slice(7));
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(input,target);
  }
  return {output,baseRevision:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),copiedFiles:files.length};
}
module.exports={copyTrackedClient};
