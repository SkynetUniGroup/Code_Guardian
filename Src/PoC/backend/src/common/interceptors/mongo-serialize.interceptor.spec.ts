/// <reference types="jest" />
import { of } from 'rxjs';
import { Types } from 'mongoose';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { MongoSerializeInterceptor } from './mongo-serialize.interceptor.js';

describe('MongoSerializeInterceptor', () => {
  let interceptor: MongoSerializeInterceptor;

  beforeEach(() => {
    interceptor = new MongoSerializeInterceptor();
  });

  function intercept(returnedValue: any): Promise<any> {
    const context = {} as ExecutionContext;
    const handler: CallHandler = { handle: () => of(returnedValue) };
    return new Promise((resolve) => {
      interceptor.intercept(context, handler).subscribe((result) => resolve(result));
    });
  }

  it('dovrebbe rinominare _id in id e rimuovere __v da un documento semplice', async () => {
    const id = new Types.ObjectId();
    const result = await intercept({ _id: id, __v: 0, name: 'demo' });

    expect(result).toEqual({ id: id.toString(), name: 'demo' });
  });

  it('dovrebbe applicare la normalizzazione ricorsivamente a un array di documenti', async () => {
    const id1 = new Types.ObjectId();
    const id2 = new Types.ObjectId();
    const result = await intercept([{ _id: id1, name: 'a' }, { _id: id2, name: 'b' }]);

    expect(result).toEqual([{ id: id1.toString(), name: 'a' }, { id: id2.toString(), name: 'b' }]);
  });

  it('dovrebbe normalizzare ricorsivamente i documenti annidati', async () => {
    const outerId = new Types.ObjectId();
    const innerId = new Types.ObjectId();
    const result = await intercept({ _id: outerId, nested: { _id: innerId, value: 42 } });

    expect(result).toEqual({ id: outerId.toString(), nested: { id: innerId.toString(), value: 42 } });
  });

  it('dovrebbe preservare le istanze Date senza convertirle in stringa', async () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = await intercept({ _id: new Types.ObjectId(), createdAt: date });

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt).toEqual(date);
  });

  it('dovrebbe convertire un Types.ObjectId passato come valore radice direttamente in stringa', async () => {
    const id = new Types.ObjectId();
    const result = await intercept(id);

    expect(result).toBe(id.toString());
  });

  it('non dovrebbe aggiungere il campo "id" a un oggetto che non ha mai avuto _id', async () => {
    const result = await intercept({ message: 'operazione riuscita' });

    expect(result).toEqual({ message: 'operazione riuscita' });
    expect(result).not.toHaveProperty('id');
  });

  it('dovrebbe lasciare invariati i valori primitivi (stringhe, numeri, null)', async () => {
    expect(await intercept('testo semplice')).toBe('testo semplice');
    expect(await intercept(42)).toBe(42);
    expect(await intercept(null)).toBeNull();
  });
});
