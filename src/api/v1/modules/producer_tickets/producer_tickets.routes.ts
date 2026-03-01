/**
 * Producer support tickets routes.
 * Base path: /api/v1/producer/tickets
 * RBAC: producer.tickets.read (GET), producer.tickets.write (create, reply, close, reopen).
 */

const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const { requireProducerPermission } = require("../../middlewares/producerAuth");
const ctrl = require("./producer_tickets.controller");

const read = requireProducerPermission(["producer.tickets.read"]);
const write = requireProducerPermission(["producer.tickets.write"]);

router.post("/", auth, write, ctrl.create);
router.get("/", auth, read, ctrl.list);
router.get("/:id", auth, read, ctrl.getOne);
router.post("/:id/messages", auth, write, ctrl.reply);
router.post("/:id/close", auth, write, ctrl.close);
router.post("/:id/reopen", auth, write, ctrl.reopen);

module.exports = router;
export {};
