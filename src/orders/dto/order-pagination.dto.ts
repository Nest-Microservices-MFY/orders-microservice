import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto';
import { OrderStatusList } from '../enum/order.enum';

export class OrderPaginationDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatusList, {
    message: `valid status are: ${OrderStatus}`,
  })
  status: OrderStatus;
}
