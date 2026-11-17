import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const verbose = process.env.V;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  const scene = r.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2));
  let tris = 0;
  for (const m of r.listMeshes())
    for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      tris += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3;
    }
  console.log(
    f.split("/").pop(),
    "size",
    size.join("x"),
    "min",
    b.min.map((v) => v.toFixed(2)).join(","),
    "tris",
    tris,
    "mats",
    r
      .listMaterials()
      .map((m) => m.getName())
      .join("|"),
    "tex",
    r
      .listTextures()
      .map((t) => t.getURI() || t.getName())
      .join("|"),
    r.listSkins().length ? `skin(${r.listSkins()[0].listJoints().length})` : "",
  );
  if (r.listAnimations().length)
    console.log(
      "  anims:",
      r
        .listAnimations()
        .map((a) => a.getName())
        .join(", "),
    );
  if (verbose)
    console.log(
      "  nodes:",
      r
        .listNodes()
        .map((n) => n.getName())
        .join(", "),
    );
}
