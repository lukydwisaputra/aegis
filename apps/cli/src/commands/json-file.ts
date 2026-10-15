import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { RunStateError } from "@qa/run-state";

/** The most a --json-file may hold: an event is a few lines, so anything larger is a wrong file, not an event. */
export const JSON_FILE_MAX_BYTES = 1024 * 1024;

/** The paths that name the process's standard input. Opening them fails (ENXIO) on Linux when stdin is a socket, so fd 0 is read instead. */
const STDIN_PATHS: ReadonlySet<string> = new Set(["/dev/stdin", "/proc/self/fd/0", "/dev/fd/0"]);

/** The file system calls the reader makes, so a test can make `open` fail the way a socket-backed stdin does. */
export interface JsonFileIo {
  open: (file: string) => number;
  isDirectory: (fd: number) => boolean;
  read: (fd: number, buf: Buffer, length: number) => number;
  close: (fd: number) => void;
}

const NODE_IO: JsonFileIo = {
  open: (file) => openSync(file, "r"),
  isDirectory: (fd) => fstatSync(fd).isDirectory(),
  read: (fd, buf, length) => readSync(fd, buf, 0, length, null),
  close: (fd) => closeSync(fd),
};

/** Wait a few milliseconds without spinning (a non-blocking stdin that has no data yet reports EAGAIN). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** What a bounded read of a caller-named file names in its refusals, and how much it may read. */
export interface BoundedReadOptions {
  /** The option the path came from, as the refusal names it (default --json-file). */
  flag?: string;
  /** The most the file may hold (default JSON_FILE_MAX_BYTES). */
  maxBytes?: number;
  /** The reason given after "is larger than N bytes" (default: an event holds its fields only). */
  tooBigWhy?: string;
}

/**
 * The text of a --json-file: UTF-8 only, read through a descriptor in chunks and never past JSON_FILE_MAX_BYTES + 1 bytes, so a pipe,
 * standard input or a device (/dev/zero) costs no more than that. A missing file, a directory or a file that is not text is refused
 * with the path. The standard-input paths read fd 0 directly.
 */
export function readJsonFile(file: string, io: JsonFileIo = NODE_IO): string {
  return readBoundedFile(file, {}, io);
}

/** readJsonFile for any option that names a file: the same bounded, UTF-8-only read, with its own option name and limit in the refusals. */
export function readBoundedFile(file: string, opts: BoundedReadOptions = {}, io: JsonFileIo = NODE_IO): string {
  const flag = opts.flag ?? "--json-file";
  const max = opts.maxBytes ?? JSON_FILE_MAX_BYTES;
  const tooBig = new RunStateError("invalid-input", `${flag} ${file} is larger than ${max} bytes: ${opts.tooBigWhy ?? "an event holds its fields only"}`);
  const chunks: Buffer[] = [];
  let total = 0;
  let fd: number | undefined;
  try {
    const stdin = STDIN_PATHS.has(file);
    fd = stdin ? 0 : io.open(file);
    if (!stdin && io.isDirectory(fd)) throw Object.assign(new Error("directory"), { code: "EISDIR" });
    const buf = Buffer.alloc(64 * 1024);
    let waited = 0;
    for (;;) {
      let n: number;
      try {
        n = io.read(fd, buf, Math.min(buf.length, max + 1 - total));
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EOF") break; // a closed pipe on some platforms
        if (code === "EAGAIN" && waited < 30_000) {
          pause(20);
          waited += 20;
          continue;
        }
        throw e;
      }
      if (n === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
      total += n;
      if (total > max) throw tooBig;
    }
  } catch (e) {
    if (e instanceof RunStateError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    const why = code === "ENOENT" ? "no such file" : code === "EISDIR" ? "not a file" : code === "EACCES" || code === "EPERM" ? "permission denied" : code === "EAGAIN" ? "no input is ready" : (code ?? "read error");
    throw new RunStateError("invalid-input", `${flag} ${file} cannot be read: ${why}`);
  } finally {
    // fd 0 belongs to the process: it is read, never closed
    if (fd !== undefined && fd !== 0) io.close(fd);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new RunStateError("invalid-input", `${flag} ${file} is not UTF-8 text`);
  }
}
