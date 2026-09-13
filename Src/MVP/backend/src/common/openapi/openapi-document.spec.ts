import type { OpenAPIObject } from "@nestjs/swagger";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi-document.factory";

// TU_27 (RV.16) — il documento OpenAPI descrive davvero l'API.
//
// Il difetto che questi casi sorvegliano non era l'assenza del documento: il
// documento c'era, con tutti gli endpoint e i metodi giusti. Era vuoto dentro.
// Nessuno schema di risposta, nessun parametro di query, e tutti e sette i DTO
// di richiesta ridotti a `{"type":"object","properties":{}}`. Un client scritto
// leggendolo chiamava l'esportazione senza `format=pdf` e prendeva un 400.
describe("Documento OpenAPI", () => {
  let doc: OpenAPIObject;

  beforeAll(async () => {
    doc = await buildOpenApiDocument();
  });

  const operations = (): Array<[string, string, Record<string, unknown>]> =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, Record<string, unknown>>)
        .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([method, op]) => [path, method, op] as [string, string, Record<string, unknown>]),
    );

  it("non espone i controller interni", () => {
    expect(Object.keys(doc.paths).filter((p) => p.startsWith("/internal"))).toEqual([]);
  });

  it("dà a ogni risposta di successo uno schema, tranne ai 204 che non hanno corpo", () => {
    const senzaSchema = operations().flatMap(([path, method, op]) =>
      Object.entries((op.responses ?? {}) as Record<string, { content?: unknown }>)
        .filter(([code, body]) => code.startsWith("2") && code !== "204" && !body.content)
        .map(([code]) => `${method.toUpperCase()} ${path} → ${code}`),
    );
    expect(senzaSchema).toEqual([]);
  });

  it("descrive le proprietà di ogni corpo di richiesta", () => {
    const schemas = (doc.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    const vuoti = operations()
      .map(([path, method, op]) => {
        const body = op.requestBody as
          | { content: Record<string, { schema: { $ref?: string } }> }
          | undefined;
        const ref = body?.content["application/json"]?.schema.$ref;
        if (!ref) {
          return null;
        }
        const name = ref.split("/").pop() as string;
        const properties = schemas[name]?.properties ?? {};
        return Object.keys(properties).length === 0 ? `${method.toUpperCase()} ${path}` : null;
      })
      .filter((entry): entry is string => entry !== null);
    expect(vuoti).toEqual([]);
  });

  it("dichiara nessuno schema privo di proprietà", () => {
    const schemas = (doc.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, unknown>; enum?: unknown[] }
    >;
    const vuoti = Object.entries(schemas)
      .filter(([, schema]) => !schema.enum && Object.keys(schema.properties ?? {}).length === 0)
      .map(([name]) => name);
    expect(vuoti).toEqual([]);
  });

  it("dichiara format come parametro di query obbligatorio dell'esportazione", () => {
    const parameters = (
      doc.paths["/reports/{id}/export"]?.get as {
        parameters?: Array<{ name: string; in: string; required?: boolean }>;
      }
    )?.parameters;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "format", in: "query", required: true }),
    );
  });

  it("dichiara i filtri facoltativi dell'elenco dei report", () => {
    const parameters =
      (
        doc.paths["/reports"]?.get as {
          parameters?: Array<{ name: string; in: string; required?: boolean }>;
        }
      )?.parameters ?? [];
    const query = parameters.filter((parameter) => parameter.in === "query");
    expect(query.map((parameter) => parameter.name).sort()).toEqual(["from", "operation", "to"]);
    expect(query.every((parameter) => parameter.required !== true)).toBe(true);
  });

  it("tipizza i parametri di percorso come obbligatori", () => {
    const nonObbligatori = operations().flatMap(([path, method, op]) =>
      ((op.parameters ?? []) as Array<{ in: string; required?: boolean; name: string }>)
        .filter((parameter) => parameter.in === "path" && parameter.required !== true)
        .map((parameter) => `${method.toUpperCase()} ${path} → ${parameter.name}`),
    );
    expect(nonObbligatori).toEqual([]);
  });
});
