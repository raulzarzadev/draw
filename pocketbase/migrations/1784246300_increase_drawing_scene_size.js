/// <reference path="../pb_data/types.d.ts" />

const sceneMaxSize = 25 * 1024 * 1024;

migrate((app) => {
  const drawings = app.findCollectionByNameOrId("drawings");
  const scene = drawings.fields.getByName("scene");

  scene.maxSize = sceneMaxSize;
  drawings.fields.add(scene);

  app.save(drawings);
}, (app) => {
  const drawings = app.findCollectionByNameOrId("drawings");
  const scene = drawings.fields.getByName("scene");

  scene.maxSize = 0;
  drawings.fields.add(scene);

  app.save(drawings);
});
