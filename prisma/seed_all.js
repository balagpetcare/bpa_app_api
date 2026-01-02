(async () => {
  console.log("🔄 Start seeding safely...");

  // existing: animalTypes + breeds
  await require("./seed.js");

  // new: social feed
  await require("./seed_social.js");

  console.log("✅ All seeding done.");
})();
