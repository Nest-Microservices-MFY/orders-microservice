import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { PrismaClient } from '@prisma/client';
import {
  ChangeOrderStatusDto,
  CreateOrderDto,
  OrderPaginationDto,
} from './dto';
import { PRODUCT_SERVICE } from '../config';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRODUCT_SERVICE) private readonly productsClient: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log(`Database connected ${new Date().toISOString()}`);
    } catch (error) {
      this.logger.error('Fail to connect database, error: ', error);
    }
  }

  /**
   *
   * Servicio para crear ordenes
   *
   */
  async create(createOrderDto: CreateOrderDto) {
    try {
      // 1 Confirmar los ID de los productos
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.productsClient.send({ cmd: 'validate_products' }, productIds),
      );

      // 2 Cálculo de valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;
        return acc + price * orderItem.quantity;
      }, 0);

      // Acumular items
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      // 3 Crear transacción en la DB
      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            },
          },
        },
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId)
            .name,
        })),
      };
    } catch (error) {
      throw new RpcException(error);
    }
  }

  /**
   *
   * Servicio para encontrar todas las ordenes con pagination y filtro de status (QueryParams)
   *
   */
  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { limit, page, status } = orderPaginationDto;

    const totalRecords = await this.order.count({
      where: {
        status: status,
      },
    });
    const lastPage = Math.ceil(totalRecords / limit);

    if (lastPage === 0) {
      return {
        metadata: {
          status: HttpStatus.OK,
          total: totalRecords,
          page: page,
          lastPage: lastPage,
          statusFilerBy: status || null,
        },
        data: [],
      };
    }

    if (page > lastPage) {
      throw new RpcException({
        message: `Page ${page} not exist, last page is ${lastPage}`,
        status: HttpStatus.NOT_FOUND,
      });
    }

    return {
      metadata: {
        status: HttpStatus.OK,
        total: totalRecords,
        page: page,
        lastPage: lastPage,
        statusFilerBy: status || null,
      },
      data: await this.order.findMany({
        take: limit,
        skip: (page - 1) * limit,
        where: {
          status: status,
        },
      }),
    };
  }

  /**
   *
   * Servicio para encontrar ordene por su ID (UUID)
   *
   */
  async findOne(id: string) {
    const order = await this.order.findUnique({
      where: {
        id: id,
      },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        message: `Order with id: ${id} not found`,
        status: HttpStatus.NOT_FOUND,
      });
    }

    const productsIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.productsClient.send({ cmd: 'validate_products' }, productsIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  /**
   *
   * Servicio para cambiar el estado de la orden por su ID (UUID)
   *
   */
  async changeOrderStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);

    if (status === order.status) return order;

    return await this.order.update({
      where: {
        id: id,
      },
      data: {
        status: status,
      },
    });
  }
}
