/**
 * BaseWebSocketService - WebSocket 服务基础类
 * 提供 ASR 和 TTS 服务的公共 WebSocket 连接管理功能
 * 
 * 公共功能：
 * 1. WebSocket 连接生命周期管理
 * 2. 消息发送与接收处理
 * 3. 任务 ID 生成与管理
 * 4. 连接状态跟踪
 * 5. 错误处理与恢复机制
 */

// WebSocket 消息类型定义
export interface WebSocketMessage {
  header: {
    action?: string;
    event?: string;
    task_id?: string;
    streaming?: string;
  };
  payload: any;
}

// 服务配置接口
export interface ServiceConfig {
  model: string;
  task_group: string;
  task: string;
  function: string;
  input: any;
  parameters: any;
}

/**
 * WebSocket 服务基础类
 * 子类应该继承此类并实现特定于服务的业务逻辑
 */
export abstract class BaseWebSocketService {
  protected config: ServiceConfig;
  protected wsUrl: string;
  protected socket: WebSocket | null = null;
  protected taskId: string = this.generateUUID();
  protected isConnected: boolean = false;          // WebSocket连接状态
  protected isTaskStarted: boolean = false;        // 当前任务是否已启动
  
  protected resolveConnectionOpened: ((value: void | PromiseLike<void>) => void) | null = null;
  protected resolveTaskStarted: ((value: void | PromiseLike<void>) => void) | null = null;

  /**
   * 构造函数
   * @param config 服务配置
   * @param wsUrlBuilder 可选的 WebSocket URL 构建器，默认使用标准 DashScope URL
   */
  constructor(config: ServiceConfig, wsUrlBuilder?: () => string) {
    const apiKey = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY is not set in environment variables.");
    }
    
    if (wsUrlBuilder) {
      this.wsUrl = wsUrlBuilder();
    } else {
      this.wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=${apiKey}`;
    }
    
    this.config = config;
  }

  /**
   * 生成 UUID（通用工具方法）
   * @returns UUID 字符串
   */
  protected generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 打开 WebSocket 连接（WebSocket 连接层）
   * 仅处理连接逻辑，不发送任何任务消息
   * 可以复用此连接来多次发送 run-task/finish-task 消息对
   * @returns Promise<void>
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 如果已经连接，直接resolve
      if (this.isConnected && this.socket) {
        console.log(`[${this.getServiceName()}] WebSocket already connected`);
        resolve();
        return;
      }

      this.resolveConnectionOpened = resolve;
      
      try {
        console.log(`[${this.getServiceName()}] Opening WebSocket connection`);
        this.socket = new WebSocket(this.wsUrl);
        this.setupSocketHandlers();
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.error(`[${this.getServiceName()}] Failed to initialize WebSocket:`, errorObj);
        this.isConnected = false;
        this.handleError(errorObj);
        reject(errorObj);
      }
    });
  }

  /**
   * 关闭 WebSocket 连接（WebSocket 连接层）
   * 这将断开与服务器的连接，无法再发送任何消息
   * 如果需要再次使用，需要重新调用 connect()
   */
  disconnect(): void {
    console.log(`[${this.getServiceName()}] Closing WebSocket connection`);
    
    // 关闭 WebSocket 连接
    if (this.socket) {
      try {
        this.socket.close(1000, "Normal closure");
      } catch (error) {
        console.error(`[${this.getServiceName()}] Failed to close WebSocket:`, error);
      }
      this.socket = null;
    }
    
    // 重置状态
    this.isConnected = false;
    this.isTaskStarted = false;
  }

  /**
   * 检查 WebSocket 连接是否已打开（WebSocket 连接层）
   * @returns 是否已连接
   */
  isConnectionOpen(): boolean {
    return this.isConnected;
  }

  /**
   * 检查当前任务是否已启动并准备好（任务层）
   * @returns 是否任务已启动
   */
  isReady(): boolean {
    return this.isConnected && this.isTaskStarted;
  }

  /**
   * 获取当前任务 ID
   * @returns 任务 ID
   */
  getTaskId(): string | null {
    return this.taskId;
  }

  /**
   * 获取服务名称（用于日志）
   * 子类应该实现此方法
   */
  protected abstract getServiceName(): string;

  /**
   * 设置 Socket 事件处理器
   * 子类可以覆盖此方法以自定义消息处理
   */
  protected setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.onConnectionOpened();
    };

    this.socket.onmessage = (event) => {
      this.onMessage(event);
    };

    this.socket.onerror = (error) => {
      this.onConnectionError(error);
    };

    this.socket.onclose = (event) => {
      this.onConnectionClosed(event);
    };
  }

  /**
   * WebSocket 连接打开时的处理
   * 子类可以覆盖此方法
   */
  protected onConnectionOpened(): void {
    console.log(`[${this.getServiceName()}] WebSocket connection established.`);
    this.isConnected = true;
    
    if (this.resolveConnectionOpened) {
      this.resolveConnectionOpened();
    }
  }

  /**
   * 处理 WebSocket 消息
   * 子类必须实现此方法
   */
  protected abstract onMessage(event: MessageEvent): void;

  /**
   * WebSocket 连接出错时的处理
   * 子类可以覆盖此方法
   */
  protected onConnectionError(error: Event): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    console.error(`[${this.getServiceName()}] WebSocket error:`, errorObj);
    this.isConnected = false;
    this.handleError(errorObj);
  }

  /**
   * WebSocket 连接关闭时的处理
   * 子类可以覆盖此方法
   */
  protected onConnectionClosed(event: CloseEvent): void {
    console.log(`[${this.getServiceName()}] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
    this.isConnected = false;
    this.isTaskStarted = false;
  }

  /**
   * 处理错误
   * 子类应该实现此方法以处理错误
   */
  protected abstract handleError(error: Error): void;

  /**
   * 发送 WebSocket 消息
   * @param message 消息对象
   */
  protected sendMessage(message: WebSocketMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.getServiceName()}] WebSocket is not connected.`);
    }

    try {
      this.socket.send(JSON.stringify(message));
      console.log(`[${this.getServiceName()}] Sent message:`, message);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`[${this.getServiceName()}] Failed to send message:`, errorObj);
      throw errorObj;
    }
  }

  /**
   * 发送二进制数据
   * @param data 二进制数据
   */
  protected sendBinaryData(data: ArrayBuffer | Int16Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.getServiceName()}] WebSocket is not connected.`);
    }

    try {
      this.socket.send(data);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`[${this.getServiceName()}] Failed to send binary data:`, errorObj);
      throw errorObj;
    }
  }
}
