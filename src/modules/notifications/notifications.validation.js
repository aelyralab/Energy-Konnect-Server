import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const listQuerySchema = { query: paginationQuery };

export const idParamSchema = { params: z.object({ id: z.string().uuid() }) };

export const unsubscribeQuerySchema = {
  query: z.object({ token: z.string().min(1, "A token is required") }),
};
