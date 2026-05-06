import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: path.join(__dirname, "index.js"),
  output: {
    path: path.join(__dirname, "dist"),
    filename: "worker.js",
    module: true,
    library: {
      type: "module"
    }
  },
  experiments: {
    outputModule: true
  },
  target: "webworker",
  mode: "production"
};

