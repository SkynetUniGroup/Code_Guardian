import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";
import type { ScopeType } from "../../common/domain-types";

export type AnalysisContextDocument = HydratedDocument<AnalysisContext>;

@Schema({ timestamps: true })
export class AnalysisContext {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  repoUrl!: string;

  @Prop({ required: true })
  repoOwner!: string;

  @Prop({ required: true })
  repoName!: string;

  @Prop({ required: true })
  isPrivate!: boolean;

  @Prop({ required: true })
  branch!: string;

  // The commit this context is pinned to — what makes a report reproducible
  // even after new commits land on the branch.
  @Prop({ required: true })
  resolvedSha!: string;

  @Prop({
    type: String,
    required: true,
    enum: ["FULL_REPOSITORY", "FILES", "DIRECTORIES"],
  })
  scopeType!: ScopeType;

  @Prop({ type: [String], default: [] })
  paths!: string[];

  @Prop({ type: [String], default: [] })
  detectedLanguages!: string[];

  // RF.24 — i linguaggi di programmazione presenti nel repository che gli
  // agenti non sanno analizzare, ordinati per numero di file decrescente.
  // Prima venivano scartati durante la rilevazione, e con essi la possibilita'
  // stessa di emettere l'avviso.
  @Prop({ type: [String], default: [] })
  unsupportedLanguages!: string[];

  // Il linguaggio con piu' file, supportato o meno; null su un repository
  // senza codice. Serve a decidere se l'avviso di RF.24 vale la pena di essere
  // mostrato: un repository *principalmente* in Go e' un caso diverso da uno
  // in TypeScript con due script di shell.
  @Prop({ type: String, default: null })
  predominantLanguage!: string | null;

  @Prop()
  estimatedFileCount!: number;

  // RV.8 — see AnalysisContextDto for why this field exists and isn't part
  // of detectedLanguages.
  @Prop({ default: false })
  nonEnglishReadmeDetected!: boolean;

  // No sprintId here — it moved to Task, since a context can be shared by
  // several operations in one batch while the Sprint ID only concerns the
  // Changelog ones.
}

export const AnalysisContextSchema = SchemaFactory.createForClass(AnalysisContext);
