import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { InstructorStatus } from '../entities/instructor.entity';

export class UpdateInstructorDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsEnum(InstructorStatus)
  status?: InstructorStatus;
}
