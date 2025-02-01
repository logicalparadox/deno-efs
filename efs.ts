import { parse } from "https://deno.land/std@0.190.0/yaml/mod.ts";
import { resolve } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.7/command/mod.ts";
import { HelpCommand } from "https://deno.land/x/cliffy@v0.25.7/command/help/mod.ts";
import * as optic from "jsr:@onjara/optic";
import { TokenReplacer } from "https://deno.land/x/optic@1.3.7/formatters/tokenReplacer.ts";
import { generateAssetReferences, IAssetReference } from "./mod.ts";

interface IConfigFile {
  /* Additional lookup path to append. Will be removed from final asset path. */
  cwd?: string;

  /* Out path for packaged assets. Can have .js or .ts extension. */
  out: string;

  /* Array of files to include relative to `cwd`. Can be globs. */
  assets: string[];
}

function validateConfig(config?: Record<string, unknown>): void {
  if (!config) {
    throw new Deno.errors.InvalidData("Config must not be empty.");
  }

  if (!config.out || typeof config.out !== "string") {
    throw new Deno.errors.InvalidData(
      "Config field 'out' must exist and be a string."
    );
  }

  if (!config.assets || !Array.isArray(config.assets)) {
    throw new Deno.errors.InvalidData(
      "Config field 'assets' must exist and be an array."
    );
  }

  const assets: unknown[] = config.assets;
  if (!assets.length) {
    throw new Deno.errors.InvalidData(
      "Config field 'assets' must have at least one entry."
    );
  }

  for (const asset of assets) {
    if (typeof asset !== "string") {
      throw new Deno.errors.InvalidData(
        "Config field 'assets' must only contain strings."
      );
    }
  }
}

const log = new optic.Logger().addStream(
  new optic.ConsoleStream()
    .withLogHeader(false)
    .withLogFooter(false)
    .withFormat(
      new TokenReplacer()
        .withFormat("{dateTime} {level} {msg} {metadata}")
        .withDateTimeFormat("hh:mm:ss")
        .withLevelPadding(10)
    )
);

function createFile(files: IAssetReference[], exportName = "assets"): string {
  const fileTxt = files.map(
    (f) => `  {
    path: "${f.asset.path}",
    contents: "${f.asset.contents}",
  },`
  );

  return `// deno-fmt-ignore-file\nexport const ${exportName} = [\n${fileTxt.join(
    "\n"
  )}\n];\n`;
}

async function buildFromParams(params: {
  cwd: string;
  globs: string[];
  out?: string;
}): Promise<string> {
  const refs: IAssetReference[] = [];

  for await (const ref of generateAssetReferences(params.cwd, params.globs)) {
    refs.push(ref);
    log.info(`${ref.asset.path} ~ ${ref.systemPath}`);
  }

  const res = createFile(refs);
  if (params.out) {
    const outPath = resolve(params.cwd, params.out);
    await Deno.writeTextFile(outPath, res);
    log.info(`Written to ${outPath}...`);
  }

  return res;
}

const buildCommand = new Command()
  .description("Build EFS asset from config file.")
  .arguments("[./assets.yml:string]")
  .option(
    "-o, --out [./assets.ts:string]",
    "Override the configured output file.",
    {
      conflicts: ["dry-run"],
    }
  )
  .option("-D, --dry-run [flag:boolean]", "Don't write the output file.", {
    default: false,
  })
  .option(
    "-s, --silent [flag:boolean]",
    "Disable all logging expect for errors",
    {
      default: false,
    }
  )
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any, relConfigPath = "./assets.yml") => {
    const { dryRun, out, silent } = opts;

    if (silent) {
      log.withMinLogLevel(optic.Level.Error);
    }

    // parse and validate config
    const configPath = resolve(Deno.cwd(), relConfigPath);

    log.info(`Reading config: ${configPath}`);
    const configRaw = await Deno.readTextFile(configPath);
    const config = parse(configRaw) as IConfigFile;

    try {
      validateConfig(config as unknown as Record<string, unknown>);
    } catch (err) {
      console.error(
        `[${(err as Error).name}]: ${(err as Error).message} (${configPath})`
      );
      Deno.exit(1);
    }

    await buildFromParams({
      cwd: config.cwd ? resolve(Deno.cwd(), config.cwd) : Deno.cwd(),
      globs: config.assets,
      out: dryRun ? undefined : out || config.out,
    });
  });

const quickBuildCommand = new Command()
  .description("Build EFS asset from command line arguments.")
  .arguments("<matchers...:string>")
  .option(
    "-o, --out [./assets.ts:string]",
    "Override the default output file.",
    {
      default: "./assets.ts",
    }
  )
  .option("-D, --dry-run [flag:boolean]", "Don't write the output file.", {
    default: false,
  })
  .option(
    "-s, --silent [flag:boolean]",
    "Disable all logging except for errors",
    {
      default: false,
    }
  )
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any, ...globs: string[]) => {
    const { dryRun, out, silent } = opts;

    if (silent) {
      log.withMinLogLevel(optic.Level.Error);
    }

    await buildFromParams({
      cwd: Deno.cwd(),
      globs,
      out: dryRun ? undefined : out,
    });
  });

const description = `
Create an archive of assets for Deno applications.
Access assets through an embedded file-system from within deployed apps.
`.trim();

const cmd = new Command()
  .name("efs")
  .description(description)
  .version("0.1.1")
  .arguments("<command>")
  .command("help", new HelpCommand())
  .command("build", buildCommand)
  .command("quick", quickBuildCommand);

try {
  await cmd.parse(Deno.args);
} catch (err) {
  log.error((err as Error).message);
}
