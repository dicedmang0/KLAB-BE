import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreditAdjustmentDto {
  // Signed: positive tops up, negative deducts. Non-zero is enforced in the service.
  @IsInt()
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
