// Resource labels must agree in every locale; changing only base leaves launcher overrides.
const fs = require('node:fs'), path = require('node:path');
function brand(output) {
  for (const scope of ['AppScope/resources', 'entry/src/main/resources']) {
    const resources = path.join(output, scope);
    const locales = new Set(['base', 'zh_CN', 'en_US', ...fs.readdirSync(resources, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name)]);
    for (const locale of locales) {
      const file = path.join(resources, locale, 'element/string.json');
      if (!fs.existsSync(file) && !['base', 'zh_CN', 'en_US'].includes(locale)) continue;
      const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { string: [] };
      for (const name of ['app_name', 'EntryAbility_label']) {
        const row = data.string.find(x => x.name === name);
        if (row) row.value = '课事清'; else data.string.push({ name, value: '课事清' });
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    }
  }
}
module.exports = { brand };
