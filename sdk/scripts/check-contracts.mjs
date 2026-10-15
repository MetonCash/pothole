import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Cell } = require("@ton/core");
const sdk = require("../dist");
const { version } = require("../package.json");

function readArtifact(relativePath) {
  try {
    return JSON.parse(readFileSync(new URL(`../../build/${relativePath}`, import.meta.url), "utf8"));
  } catch {
    throw new Error(`Cannot read build/${relativePath}. Run npm run build from the repository root.`);
  }
}

try {
  const { version: rootVersion } = require("../../package.json");
  assert.equal(version, rootVersion, "Root and SDK package versions differ.");
  for (const name of ["Pothole", "PotholeFactory"]) {
    const artifact = readArtifact(`${name}.json`);
    const abi = readArtifact(`abi/${name}.json`);
    assert.equal(abi.version, version, `${name}: contract ABI and SDK package versions differ.`);
    const wrapper = sdk[name];
    const expectedCode = Cell.fromBase64(artifact.code_boc64);
    assert(wrapper.CodeCell.equals(expectedCode), `${name}: SDK bytecode differs from the compiled contract.`);
    assert.deepEqual(
      wrapper.Errors,
      Object.fromEntries(abi.thrown_errors.map(({ name, err_code }) => [name, err_code])),
      `${name}: SDK error codes differ from the compiled ABI.`,
    );
    for (const method of abi.get_methods) {
      assert.equal(typeof wrapper.prototype[method.name], "function", `${name}: missing getter ${method.name}.`);
    }
    console.log(`${name}: version, bytecode, error codes and getters match the compiled contract (${version}).`);
  }
} catch (error) {
  console.error(error.message);
  console.error("Check package versions, then run npm run generate:sdk and npm run check:sdk from the repository root.");
  process.exitCode = 1;
}
