import { Router, type IRouter } from "express";
import healthRouter from "./health";
import menuLocalRouter from "./menu-local";

const router: IRouter = Router();

router.use(healthRouter);
router.use(menuLocalRouter);

export default router;
