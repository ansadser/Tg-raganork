const fs = require("fs");
const path = require("path");
const config = require("./config");

for (const f of fs.readdirSync(path.join(__dirname, "plugins")).filter((f) => f.endsWith(".js"))) {
  try { require(`./plugins/${f}`); console.log("plugin loaded:", f); }
  catch (e) { console.error(`plugin ${f} failed:`, e.message); }
}
const { start } = require("./core/bot");
start().catch((e) => { console.error(e.message); process.exit(1); });

if (process.env.PORT)
  require("http").createServer((_, res) => res.end("OK")).listen(process.env.PORT);
