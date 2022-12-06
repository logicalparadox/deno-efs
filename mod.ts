import * as base64 from "https://deno.land/std@0.167.0/encoding/base64.ts";
import { expandGlob } from "https://deno.land/std@0.167.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.167.0/path/mod.ts";

const { globToRegExp, relative } = path;
const { fromFileUrl, toFileUrl } = path.posix;

export interface IArchiveAssetReference {
  /** Embedded file system path of asset. POSIX format. */
  path: string;

  /** Asset encoded as base64 string. */
  contents: string;
}

export interface IAssetReference {
  /** Local path of asset. Used for logging. */
  systemPath: string;

  /** Asset reference. */
  asset: IArchiveAssetReference;
}

/**
 * Given a starting directory and an array of glob matchers, emit an
 * `IAssetReference` for each file that matches. Will guard against duplicate
 * files being emitted unless `allowDuplicates` is set to true.
 *
 * @param cwd base directory to use for search
 * @param globs array of globs as strings for matching
 * @param allowDuplicates default `false`
 */
export async function* generateAssetReferences(
  cwd: string,
  globs: string[],
  allowDuplicates = false
): AsyncGenerator<IAssetReference, void, void> {
  // memory for duplicate skip
  const files: string[] = [];

  // iterate globs then files for each glob
  for (const glob of globs) {
    for await (const file of expandGlob(glob, { root: cwd, globstar: true })) {
      if (
        file.isFile &&
        !file.isSymlink &&
        (allowDuplicates || !files.includes(file.path))
      ) {
        files.push(file.path);
        const rel = relative(cwd, file.path);
        const fileContents = await Deno.readFile(file.path);

        // IAssetReference
        yield {
          systemPath: file.path,
          asset: {
            path: fromFileUrl(`file:///${rel}`),
            contents: base64.encode(fileContents),
          },
        };
      }
    }
  }
}

export interface AssetReader {
  /**
   * Read file contents asyncronously to `Uint8Array`.
   */
  readFile(
    path: string | URL,
    options?: Deno.ReadFileOptions
  ): Promise<Uint8Array>;

  /**
   * Read file contents syncronously to `Uint8Array`.
   */
  readFileSync(path: string | URL): Uint8Array;

  /**
   * Read file contents as `UTF-8` asyncronously to `string`.
   */
  readTextFile(
    path: string | URL,
    options?: Deno.ReadFileOptions
  ): Promise<string>;

  /**
   * Read file contents as `UTF-8` syncronously to `string`.
   */
  readTextFileSync(path: string | URL): string;
}

export class ArchiveReader implements AssetReader {
  constructor(public readonly assets: IArchiveAssetReference[]) {}

  #decodeBuffer(raw: BufferSource): string {
    return new TextDecoder("utf-8").decode(raw);
  }

  #toPathString(path: string | URL): string {
    const urlPath = path instanceof URL ? path : toFileUrl(path);
    return urlPath.href;
  }

  *expandGlob(glob: string): Generator<string, void, void> {
    const re = globToRegExp(glob);
    for (const record of this.assets) {
      if (re.test(record.path)) {
        yield record.path;
      }
    }
  }

  readFileSync(path: string | URL): Uint8Array {
    const comparePath = this.#toPathString(path);
    const file = this.assets.find(
      (e) => this.#toPathString(e.path) === comparePath
    );

    if (!file) throw new Deno.errors.NotFound(`File not found: ${comparePath}`);
    return base64.decode(file.contents);
  }

  readFile(path: string | URL): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let res;
      try {
        res = this.readFileSync(path);
      } catch (err) {
        reject(err);
        return;
      }

      resolve(res);
    });
  }

  readTextFileSync(path: string | URL): string {
    const raw = this.readFileSync(path);
    return this.#decodeBuffer(raw);
  }

  async readTextFile(path: string | URL): Promise<string> {
    const raw = await this.readFile(path);
    return this.#decodeBuffer(raw);
  }
}
