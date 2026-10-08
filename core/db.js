// tiny JSON key-value store: db.get(ns, key, default) / set / del / entries
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../config");
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, "db.json");
let data = {};
try { data = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
let timer;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(data));
    fs.renameSync(FILE + ".tmp", FILE);
  }, 500);
}
module.exports = {
  get: (ns, key, def) => data[ns]?.[key] ?? def,
  set: (ns, key, val) => { (data[ns] ||= {})[key] = val; save(); return val; },
  del: (ns, key) => { if (data[ns]) { delete data[ns][key]; save(); } },
  entries: (ns) => data[ns] || {},
  flush: () => { clearTimeout(timer); fs.writeFileSync(FILE, JSON.stringify(data)); },
};
