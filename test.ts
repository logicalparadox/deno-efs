import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.167.0/testing/asserts.ts";
import {
  dirname,
  fromFileUrl,
  resolve,
} from "https://deno.land/std@0.167.0/path/mod.ts";
import {
  ArchiveReader,
  generateAssetReferences,
  IAssetReference,
} from "./mod.ts";
import { assets as archive } from "./test_assets/assets.ts";

const rootDir = dirname(fromFileUrl(import.meta.url));

Deno.test("api", async (t) => {
  const files: IAssetReference[] = [];

  for await (const file of generateAssetReferences(rootDir, [
    "./test_assets/*.txt",
  ])) {
    files.push(file);
  }

  await t.step("glob iteration", () => {
    assertEquals(files.length, 2);
    assertEquals(files[0].asset.path, "/test_assets/asset_1.txt");
    assertEquals(files[0].asset.contents.length, 16);
    assertEquals(files[1].asset.path, "/test_assets/asset_2.txt");
    assertEquals(files[1].asset.contents.length, 48);
  });
});

Deno.test("mod", async (t) => {
  const vfs = new ArchiveReader(archive);

  await t.step("reading generated contents", async () => {
    const assetOne = await Deno.readTextFile(
      resolve(rootDir, "./test_assets/asset_1.txt")
    );
    const assetTwo = await Deno.readTextFile(
      resolve(rootDir, "./test_assets/asset_2.txt")
    );

    assertEquals(vfs.readTextFileSync("/test_assets/asset_1.txt"), assetOne);
    assertEquals(vfs.readTextFileSync("/test_assets/asset_2.txt"), assetTwo);
  });

  await t.step("listing files by glob", () => {
    const files: string[] = [];
    for (const file of vfs.expandGlob("/test_assets/*_2.txt")) {
      assert(file !== null);
      files.push(file);
    }

    assertEquals(files.length, 1);
    assertEquals(files[0], "/test_assets/asset_2.txt");
  });
});
