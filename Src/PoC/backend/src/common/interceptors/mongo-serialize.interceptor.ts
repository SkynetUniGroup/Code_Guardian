import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Types } from 'mongoose';

function normalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    const { _id, __v, ...rest } = value;
    const normalized: Record<string, any> = {};

    for (const key of Object.keys(rest)) {
      normalized[key] = normalize(rest[key]);
    }

    // Se c'era un _id, lo esponiamo come `id`; altrimenti l'oggetto resta invariato
    return _id !== undefined ? { id: normalize(_id), ...normalized } : normalized;
  }

  return value;
}

@Injectable()
export class MongoSerializeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => normalize(data)));
  }
}