import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Report, ReportDocument } from './schemas/report.schema.js';
import type { ReportStatus, OperationCode } from '../common/dto/types.js';
@Injectable()
export class ReportService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
  ) {}

  async create(data: Partial<Report>): Promise<ReportDocument> {
    return this.reportModel.create(data);
  }

  async findById(id: string | Types.ObjectId): Promise<ReportDocument | null> {
    return this.reportModel.findById(id).exec();
  }

  async findByTaskId(taskId: string | Types.ObjectId): Promise<ReportDocument | null> {
    return this.reportModel.findOne({ taskId }).exec();
  }

  async updateStatus(
    id: string | Types.ObjectId,
    status: ReportStatus,
  ): Promise<ReportDocument | null> {
    return this.reportModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();
  }

  async findAll(): Promise<ReportDocument[]> {
    return this.reportModel.find().exec();
  }

  async update(
    id: string | Types.ObjectId,
    updateData: Partial<Report>,
  ): Promise<ReportDocument | null> {
    return this.reportModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
  }
}