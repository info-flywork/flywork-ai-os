import { loadEnvConfig } from "@next/env";
import { productionProblems } from "../src/server/runtime/productionEnv";

loadEnvConfig(process.cwd());

const problems = productionProblems(process.env, "production");
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

console.log("Üretim ortamı değişkenleri tamam.");
