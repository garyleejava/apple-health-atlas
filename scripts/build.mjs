import { execFileSync } from "node:child_process";

execFileSync("python3", ["scripts/build_sample.py"], { stdio: "inherit" });
console.log("build complete: synthetic fixture is ready");
