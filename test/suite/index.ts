import * as path from "path";
import * as fs from "fs";
import Mocha from "mocha";

function findTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTestFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      acc.push(full);
    }
  }
  return acc;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 60000,
  });

  const testsRoot = path.resolve(__dirname);
  for (const file of findTestFiles(testsRoot)) {
    if (!file.includes(`${path.sep}runTest${path.extname(file)}`)) {
      mocha.addFile(file);
    }
  }

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
