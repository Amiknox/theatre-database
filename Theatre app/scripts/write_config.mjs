import fs from "node:fs/promises";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

const contents = `window.THEATRE_CONFIG = {
  supabaseUrl: ${JSON.stringify(supabaseUrl)},
  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)}
};
`;

await fs.writeFile("config.js", contents, "utf8");
console.log(supabaseUrl && supabaseAnonKey
  ? "Wrote config.js with Supabase settings."
  : "Wrote config.js in local fallback mode because Supabase env vars are missing.");
