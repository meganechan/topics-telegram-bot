# Test-Driven Development Structure

## 1. Overall Testing Strategy

### 1.1 Testing Pyramid
```
                    E2E Tests
                 ┌─────────────┐
                │   API Tests   │
              ┌───────────────────┐
             │ Integration Tests   │
           ┌─────────────────────────┐
          │      Unit Tests           │
        └───────────────────────────────┘
```

### 1.2 Test Organization per Context
```
tests/
├── unit/                      # Unit Tests (60%)
│   ├── ticketing/
│   ├── communication/
│   ├── user-management/
│   ├── integration/
│   ├── file-management/
│   └── shared/
├── integration/               # Integration Tests (30%)
│   ├── ticketing/
│   ├── communication/
│   ├── user-management/
│   ├── integration/
│   ├── file-management/
│   └── shared/
├── e2e/                      # End-to-End Tests (10%)
│   ├── ticket-workflows/
│   ├── message-flows/
│   ├── api-integration/
│   └── telegram-bot/
└── fixtures/                 # Test Data & Mocks
    ├── data/
    ├── mocks/
    └── stubs/
```

## 2. Unit Tests per Context

### 2.1 Ticketing Context Unit Tests
```
tests/unit/ticketing/
├── domain/
│   ├── entities/
│   │   ├── ticket.entity.spec.ts
│   │   ├── ticket-priority.value-object.spec.ts
│   │   └── ticket-status.value-object.spec.ts
│   ├── services/
│   │   ├── ticket-creation.domain-service.spec.ts
│   │   ├── ticket-lifecycle.domain-service.spec.ts
│   │   └── ticket-assignment.domain-service.spec.ts
│   └── events/
│       ├── ticket-created.event.spec.ts
│       └── ticket-closed.event.spec.ts
├── application/
│   ├── handlers/
│   │   ├── create-ticket.handler.spec.ts
│   │   ├── update-ticket.handler.spec.ts
│   │   └── close-ticket.handler.spec.ts
│   └── queries/
│       ├── get-ticket.query.spec.ts
│       └── get-tickets.query.spec.ts
└── infrastructure/
    ├── repositories/
    │   └── ticket.repository.spec.ts
    └── adapters/
        └── ticket-id-generator.adapter.spec.ts
```

#### Example: Ticket Entity Test
```typescript
// tests/unit/ticketing/domain/entities/ticket.entity.spec.ts
describe('Ticket Entity', () => {
  describe('creation', () => {
    it('should create a ticket with valid data', () => {
      // Arrange
      const ticketData = {
        id: 'TICK-001',
        title: 'Test Ticket',
        description: 'Test Description',
        priority: TicketPriority.MEDIUM,
        createdBy: 'user-123'
      };

      // Act
      const ticket = Ticket.create(ticketData);

      // Assert
      expect(ticket.getId()).toBe('TICK-001');
      expect(ticket.getTitle()).toBe('Test Ticket');
      expect(ticket.getStatus()).toBe(TicketStatus.OPEN);
      expect(ticket.getPriority()).toBe(TicketPriority.MEDIUM);
    });

    it('should throw error when title is empty', () => {
      // Arrange
      const ticketData = {
        id: 'TICK-001',
        title: '',
        description: 'Test Description',
        priority: TicketPriority.MEDIUM,
        createdBy: 'user-123'
      };

      // Act & Assert
      expect(() => Ticket.create(ticketData))
        .toThrow('Ticket title cannot be empty');
    });
  });

  describe('status transitions', () => {
    it('should transition from OPEN to CLOSED', () => {
      // Arrange
      const ticket = createTicketWithStatus(TicketStatus.OPEN);

      // Act
      ticket.close('user-456', 'Issue resolved');

      // Assert
      expect(ticket.getStatus()).toBe(TicketStatus.CLOSED);
      expect(ticket.getClosedBy()).toBe('user-456');
      expect(ticket.getClosedAt()).toBeInstanceOf(Date);
    });

    it('should not allow closing already closed ticket', () => {
      // Arrange
      const ticket = createTicketWithStatus(TicketStatus.CLOSED);

      // Act & Assert
      expect(() => ticket.close('user-456', 'Already closed'))
        .toThrow('Cannot close an already closed ticket');
    });
  });

  describe('domain events', () => {
    it('should raise TicketCreated event when ticket is created', () => {
      // Arrange
      const ticketData = createValidTicketData();

      // Act
      const ticket = Ticket.create(ticketData);

      // Assert
      const events = ticket.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(TicketCreatedEvent);
      expect(events[0].ticketId).toBe(ticket.getId());
    });
  });
});
```

### 2.2 Communication Context Unit Tests
```
tests/unit/communication/
├── domain/
│   ├── entities/
│   │   ├── message.entity.spec.ts
│   │   ├── topic.entity.spec.ts
│   │   └── conversation.entity.spec.ts
│   ├── services/
│   │   ├── message-sync.domain-service.spec.ts
│   │   ├── topic-linking.domain-service.spec.ts
│   │   └── conversation-management.domain-service.spec.ts
│   └── value-objects/
│       ├── message-content.value-object.spec.ts
│       └── telegram-topic-id.value-object.spec.ts
├── application/
│   └── handlers/
│       ├── send-message.handler.spec.ts
│       ├── create-topic.handler.spec.ts
│       └── telegram-message.handler.spec.ts
└── infrastructure/
    ├── external/
    │   ├── telegram-api.adapter.spec.ts
    │   └── telegram-api.client.spec.ts
    └── repositories/
        ├── message.repository.spec.ts
        └── topic.repository.spec.ts
```

#### Example: Message Sync Service Test
```typescript
// tests/unit/communication/domain/services/message-sync.domain-service.spec.ts
describe('MessageSyncDomainService', () => {
  let service: MessageSyncDomainService;
  let mockTopicRepository: MockTopicRepository;
  let mockMessageRepository: MockMessageRepository;

  beforeEach(() => {
    mockTopicRepository = new MockTopicRepository();
    mockMessageRepository = new MockMessageRepository();
    service = new MessageSyncDomainService(
      mockTopicRepository,
      mockMessageRepository
    );
  });

  describe('syncMessage', () => {
    it('should sync message to linked topics', async () => {
      // Arrange
      const sourceTopic = createTopic('topic-1');
      const linkedTopic = createTopic('topic-2');
      sourceTopic.linkTo(linkedTopic.getId());

      const message = createMessage('Hello World', sourceTopic.getId());

      mockTopicRepository.save(sourceTopic);
      mockTopicRepository.save(linkedTopic);

      // Act
      await service.syncMessage(message);

      // Assert
      const syncedMessages = mockMessageRepository.findByTopicId(linkedTopic.getId());
      expect(syncedMessages).toHaveLength(1);
      expect(syncedMessages[0].getContent()).toContain('Hello World');
      expect(syncedMessages[0].isSynced()).toBe(true);
    });

    it('should not sync message if no linked topics', async () => {
      // Arrange
      const sourceTopic = createTopic('topic-1');
      const message = createMessage('Hello World', sourceTopic.getId());

      mockTopicRepository.save(sourceTopic);

      // Act
      await service.syncMessage(message);

      // Assert
      const allMessages = mockMessageRepository.findAll();
      expect(allMessages).toHaveLength(0);
    });

    it('should prevent circular message sync', async () => {
      // Arrange
      const topic1 = createTopic('topic-1');
      const topic2 = createTopic('topic-2');
      topic1.linkTo(topic2.getId());
      topic2.linkTo(topic1.getId());

      const message = createMessage('Test', topic1.getId());
      message.markAsAlreadySynced([topic2.getId()]);

      mockTopicRepository.save(topic1);
      mockTopicRepository.save(topic2);

      // Act
      await service.syncMessage(message);

      // Assert
      const topic2Messages = mockMessageRepository.findByTopicId(topic2.getId());
      expect(topic2Messages).toHaveLength(0); // Should not create circular sync
    });
  });
});
```

### 2.3 User Management Context Unit Tests
```
tests/unit/user-management/
├── domain/
│   ├── entities/
│   │   ├── user.entity.spec.ts
│   │   ├── group.entity.spec.ts
│   │   └── user-mention.entity.spec.ts
│   ├── services/
│   │   ├── user-registration.domain-service.spec.ts
│   │   ├── internal-user-lookup.domain-service.spec.ts
│   │   ├── inline-reply.domain-service.spec.ts
│   │   └── group-management.domain-service.spec.ts
│   └── value-objects/
│       ├── telegram-user-id.value-object.spec.ts
│       └── internal-username.value-object.spec.ts
└── application/
    └── handlers/
        ├── register-user.handler.spec.ts
        ├── mention-user.handler.spec.ts
        └── inline-reply.handler.spec.ts
```

### 2.4 Integration Context Unit Tests
```
tests/unit/integration/
├── domain/
│   ├── entities/
│   │   ├── webhook.entity.spec.ts
│   │   ├── api-key.entity.spec.ts
│   │   └── external-system.entity.spec.ts
│   ├── services/
│   │   ├── webhook-execution.domain-service.spec.ts
│   │   ├── api-authentication.domain-service.spec.ts
│   │   └── event-publishing.domain-service.spec.ts
│   └── value-objects/
│       ├── webhook-url.value-object.spec.ts
│       └── hook-event.value-object.spec.ts
└── application/
    └── handlers/
        ├── create-webhook.handler.spec.ts
        ├── execute-webhook.handler.spec.ts
        └── event-listener.handler.spec.ts
```

#### Example: Webhook Execution Test
```typescript
// tests/unit/integration/domain/services/webhook-execution.domain-service.spec.ts
describe('WebhookExecutionDomainService', () => {
  let service: WebhookExecutionDomainService;
  let mockHttpClient: MockHttpClient;

  beforeEach(() => {
    mockHttpClient = new MockHttpClient();
    service = new WebhookExecutionDomainService(mockHttpClient);
  });

  describe('executeWebhook', () => {
    it('should execute webhook successfully', async () => {
      // Arrange
      const webhook = createWebhook({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        event: HookEvent.TICKET_CREATED
      });

      const payload = { ticketId: 'TICK-001', title: 'Test Ticket' };
      mockHttpClient.mockResponse(200, { success: true });

      // Act
      const result = await service.executeWebhook(webhook, payload);

      // Assert
      expect(result.isSuccess()).toBe(true);
      expect(mockHttpClient.getLastRequest()).toEqual({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        data: payload,
        headers: webhook.getHeaders()
      });
    });

    it('should retry on failure', async () => {
      // Arrange
      const webhook = createWebhook({
        url: 'https://api.example.com/webhook',
        retryCount: 2
      });

      const payload = { ticketId: 'TICK-001' };
      mockHttpClient
        .mockResponse(500, { error: 'Server Error' }) // First attempt fails
        .mockResponse(500, { error: 'Server Error' }) // Second attempt fails
        .mockResponse(200, { success: true });         // Third attempt succeeds

      // Act
      const result = await service.executeWebhook(webhook, payload);

      // Assert
      expect(result.isSuccess()).toBe(true);
      expect(mockHttpClient.getRequestCount()).toBe(3);
    });

    it('should fail after max retries', async () => {
      // Arrange
      const webhook = createWebhook({
        url: 'https://api.example.com/webhook',
        retryCount: 2
      });

      const payload = { ticketId: 'TICK-001' };
      mockHttpClient.mockAlwaysResponse(500, { error: 'Server Error' });

      // Act
      const result = await service.executeWebhook(webhook, payload);

      // Assert
      expect(result.isFailure()).toBe(true);
      expect(result.getError()).toContain('Max retries exceeded');
      expect(mockHttpClient.getRequestCount()).toBe(3); // Original + 2 retries
    });
  });
});
```

### 2.5 File Management Context Unit Tests
```
tests/unit/file-management/
├── domain/
│   ├── entities/
│   │   └── attachment.entity.spec.ts
│   ├── services/
│   │   ├── file-download.domain-service.spec.ts
│   │   ├── file-validation.domain-service.spec.ts
│   │   └── storage-management.domain-service.spec.ts
│   └── value-objects/
│       ├── file-type.value-object.spec.ts
│       ├── file-size.value-object.spec.ts
│       └── file-path.value-object.spec.ts
└── application/
    └── handlers/
        ├── upload-file.handler.spec.ts
        └── download-file.handler.spec.ts
```

## 3. Integration Tests per Context

### 3.1 Integration Test Structure
```
tests/integration/
├── ticketing/
│   ├── repositories/
│   │   └── ticket.repository.integration.spec.ts
│   └── workflows/
│       └── ticket-lifecycle.integration.spec.ts
├── communication/
│   ├── repositories/
│   │   ├── message.repository.integration.spec.ts
│   │   └── topic.repository.integration.spec.ts
│   ├── external/
│   │   └── telegram-api.integration.spec.ts
│   └── workflows/
│       └── message-sync.integration.spec.ts
├── user-management/
│   ├── repositories/
│   │   ├── user.repository.integration.spec.ts
│   │   └── group.repository.integration.spec.ts
│   └── workflows/
│       └── user-registration.integration.spec.ts
├── integration/
│   ├── repositories/
│   │   ├── webhook.repository.integration.spec.ts
│   │   └── api-key.repository.integration.spec.ts
│   ├── external/
│   │   └── webhook-execution.integration.spec.ts
│   └── workflows/
│       └── event-publishing.integration.spec.ts
└── file-management/
    ├── repositories/
    │   └── attachment.repository.integration.spec.ts
    ├── external/
    │   ├── telegram-file-download.integration.spec.ts
    │   └── local-storage.integration.spec.ts
    └── workflows/
        └── file-processing.integration.spec.ts
```

#### Example: Repository Integration Test
```typescript
// tests/integration/ticketing/repositories/ticket.repository.integration.spec.ts
describe('TicketRepository Integration', () => {
  let repository: TicketRepository;
  let mongoConnection: MongoConnection;

  beforeAll(async () => {
    mongoConnection = await createTestConnection();
    repository = new TicketRepository(mongoConnection);
  });

  afterAll(async () => {
    await mongoConnection.close();
  });

  beforeEach(async () => {
    await cleanupDatabase(mongoConnection);
  });

  describe('save', () => {
    it('should save ticket to database', async () => {
      // Arrange
      const ticket = createTicket({
        id: 'TICK-001',
        title: 'Test Ticket',
        status: TicketStatus.OPEN
      });

      // Act
      await repository.save(ticket);

      // Assert
      const savedTicket = await repository.findById('TICK-001');
      expect(savedTicket).toBeDefined();
      expect(savedTicket.getTitle()).toBe('Test Ticket');
      expect(savedTicket.getStatus()).toBe(TicketStatus.OPEN);
    });

    it('should update existing ticket', async () => {
      // Arrange
      const ticket = createTicket({ id: 'TICK-001', title: 'Original Title' });
      await repository.save(ticket);

      ticket.updateTitle('Updated Title');

      // Act
      await repository.save(ticket);

      // Assert
      const updatedTicket = await repository.findById('TICK-001');
      expect(updatedTicket.getTitle()).toBe('Updated Title');
    });
  });

  describe('findByStatus', () => {
    it('should find tickets by status', async () => {
      // Arrange
      const openTicket = createTicket({ id: 'TICK-001', status: TicketStatus.OPEN });
      const closedTicket = createTicket({ id: 'TICK-002', status: TicketStatus.CLOSED });

      await repository.save(openTicket);
      await repository.save(closedTicket);

      // Act
      const openTickets = await repository.findByStatus(TicketStatus.OPEN);

      // Assert
      expect(openTickets).toHaveLength(1);
      expect(openTickets[0].getId()).toBe('TICK-001');
    });
  });
});
```

## 4. End-to-End Tests

### 4.1 E2E Test Structure
```
tests/e2e/
├── ticket-workflows/
│   ├── create-ticket-via-telegram.e2e.spec.ts
│   ├── create-ticket-via-api.e2e.spec.ts
│   ├── ticket-lifecycle.e2e.spec.ts
│   └── ticket-assignment.e2e.spec.ts
├── message-flows/
│   ├── message-synchronization.e2e.spec.ts
│   ├── topic-linking.e2e.spec.ts
│   ├── user-mention.e2e.spec.ts
│   └── file-attachment.e2e.spec.ts
├── api-integration/
│   ├── rest-api-endpoints.e2e.spec.ts
│   ├── authentication.e2e.spec.ts
│   ├── rate-limiting.e2e.spec.ts
│   └── webhook-execution.e2e.spec.ts
└── telegram-bot/
    ├── bot-commands.e2e.spec.ts
    ├── group-management.e2e.spec.ts
    └── topic-creation.e2e.spec.ts
```

#### Example: E2E Test
```typescript
// tests/e2e/ticket-workflows/create-ticket-via-api.e2e.spec.ts
describe('Create Ticket via API E2E', () => {
  let app: INestApplication;
  let apiKey: string;
  let testGroupId: string;

  beforeAll(async () => {
    app = await createTestApp();
    apiKey = await generateTestApiKey();
    testGroupId = await createTestTelegramGroup();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  it('should create ticket and topic via API', async () => {
    // Arrange
    const createTicketRequest = {
      title: 'API Test Ticket',
      description: 'Created via API',
      priority: 'high',
      groupId: testGroupId
    };

    // Act - Create Ticket
    const response = await request(app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey)
      .send(createTicketRequest)
      .expect(201);

    // Assert - Ticket Created
    expect(response.body.success).toBe(true);
    expect(response.body.data.ticketId).toBeDefined();
    expect(response.body.data.topicId).toBeDefined();

    const ticketId = response.body.data.ticketId;
    const topicId = response.body.data.topicId;

    // Act - Verify Ticket in Database
    const getTicketResponse = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticketId}`)
      .set('X-API-Key', apiKey)
      .expect(200);

    // Assert - Ticket Details
    expect(getTicketResponse.body.data.ticket.title).toBe('API Test Ticket');
    expect(getTicketResponse.body.data.ticket.status).toBe('open');
    expect(getTicketResponse.body.data.topic.telegramTopicId).toBe(topicId);

    // Act - Verify Topic Created in Telegram
    const topicExists = await verifyTelegramTopicExists(testGroupId, topicId);
    expect(topicExists).toBe(true);

    // Act - Send Message to Ticket
    const messageResponse = await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticketId}/messages`)
      .set('X-API-Key', apiKey)
      .send({
        content: 'Test message from API',
        sender: { name: 'API User', externalId: 'api-user-1' }
      })
      .expect(201);

    // Assert - Message Sent
    expect(messageResponse.body.success).toBe(true);
    expect(messageResponse.body.data.messageId).toBeDefined();

    // Verify message appears in Telegram
    const telegramMessage = await getTelegramMessage(testGroupId, topicId, messageResponse.body.data.messageId);
    expect(telegramMessage.text).toContain('Test message from API');
    expect(telegramMessage.text).toContain('API User');
  });

  it('should trigger webhook when ticket is created', async () => {
    // Arrange
    const webhookUrl = await createTestWebhookEndpoint();
    await createWebhook({
      name: 'Test Webhook',
      event: 'ticket.created',
      url: webhookUrl,
      method: 'POST'
    });

    const createTicketRequest = {
      title: 'Webhook Test Ticket',
      groupId: testGroupId
    };

    // Act
    await request(app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey)
      .send(createTicketRequest)
      .expect(201);

    // Assert
    await waitForWebhookCall();
    const webhookCalls = await getWebhookCalls(webhookUrl);

    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0].body.event).toBe('ticket.created');
    expect(webhookCalls[0].body.data.ticket.title).toBe('Webhook Test Ticket');
  });
});
```

## 5. Test Utilities and Fixtures

### 5.1 Test Utilities
```typescript
// tests/fixtures/test-utilities.ts
export class TestUtilities {
  static async createTestApp(): Promise<INestApplication> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideProvider(ConfigService)
    .useValue(createTestConfig())
    .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();
    return app;
  }

  static createTestConfig(): ConfigService {
    return {
      get: (key: string) => {
        const config = {
          'database.url': 'mongodb://localhost:27017/test',
          'telegram.token': 'test-bot-token',
          'telegram.webhook.url': 'https://test.webhook.url'
        };
        return config[key];
      }
    };
  }

  static async cleanupDatabase(connection: MongoConnection): Promise<void> {
    const collections = await connection.db.collections();
    await Promise.all(
      collections.map(collection => collection.deleteMany({}))
    );
  }
}
```

### 5.2 Mock Factories
```typescript
// tests/fixtures/mocks/ticket.factory.ts
export class TicketFactory {
  static create(overrides: Partial<TicketData> = {}): Ticket {
    const defaultData: TicketData = {
      id: `TICK-${Date.now()}`,
      title: 'Test Ticket',
      description: 'Test Description',
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      createdBy: 'test-user',
      groupId: 'test-group',
      createdAt: new Date()
    };

    return Ticket.create({ ...defaultData, ...overrides });
  }

  static createBatch(count: number, overrides: Partial<TicketData> = {}): Ticket[] {
    return Array.from({ length: count }, (_, i) =>
      this.create({
        ...overrides,
        id: `TICK-${Date.now()}-${i}`,
        title: `Test Ticket ${i + 1}`
      })
    );
  }
}
```

## 6. Test Coverage Goals

### 6.1 Coverage Targets per Context
- **Unit Tests**: 90%+ coverage
- **Integration Tests**: 80%+ coverage
- **E2E Tests**: Critical paths coverage

### 6.2 Coverage Breakdown
```
┌─────────────────┬──────────┬──────────┬──────────┐
│ Context         │ Unit %   │ Int %    │ E2E %    │
├─────────────────┼──────────┼──────────┼──────────┤
│ Ticketing       │   95%    │   85%    │   90%    │
│ Communication   │   90%    │   80%    │   85%    │
│ User Management │   90%    │   80%    │   75%    │
│ Integration     │   92%    │   85%    │   80%    │
│ File Management │   88%    │   75%    │   70%    │
│ Shared          │   95%    │   90%    │   N/A    │
└─────────────────┴──────────┴──────────┴──────────┘
```

## 7. CI/CD Pipeline Testing
```yaml
# .github/workflows/test.yml
stages:
  - unit-tests:
      parallel:
        - ticketing-unit-tests
        - communication-unit-tests
        - user-management-unit-tests
        - integration-unit-tests
        - file-management-unit-tests

  - integration-tests:
      parallel:
        - ticketing-integration-tests
        - communication-integration-tests
        - user-management-integration-tests
        - integration-integration-tests
        - file-management-integration-tests

  - e2e-tests:
      sequential:
        - api-e2e-tests
        - telegram-bot-e2e-tests
        - workflow-e2e-tests
```

การแบ่ง test structure แบบนี้จะทำให้:
1. **แยก concern**: แต่ละ context มี test ที่เป็นอิสระ
2. **ง่ายต่อการ maintain**: เพิ่ม/ลด test ได้ง่าย
3. **Parallel execution**: run test หลาย context พร้อมกัน
4. **Clear coverage**: วัดผล coverage ได้ชัดเจนแต่ละ context