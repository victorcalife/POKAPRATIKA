import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { ApiError } from '../types';

export function httpError(status: number, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function validate<T>(schema: ZodSchema<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw httpError(400, error.issues.map((issue) => issue.message).join('; '));
    }
    throw error;
  }
}
