# Docklet — Live User Test (End-to-End)

## Цель
Проверить Docklet в реальном сценарии:
- пользователь устанавливает Docklet
- подключает ноду
- деплоит контейнер
- обновляет его
- проверяет rollback при ошибке

---

# 0. Предусловия

- Linux host (node-1)
- Docker Engine >= 24.x установлен и запущен
- Порты Control Plane доступны (например, :8080)
- Пользователь имеет доступ к shell

---

# 1. Установка Control Plane (Admin)

### 1.1 Запуск Control Plane
```bash
docker run -d \
  --name docklet-cp \
  -p 8080:8080 \
  -v docklet-data:/data \
  docklet/control-plane:latest
```
### 1.2 Проверка
```bash
curl http://localhost:8080/api/health
```
Ожидаемый результат
```json
{ "status": "ok" }
```

# 2. Подключение Node (Agent)

### 2.1 Запуск Agent на node-1
```bash
docker run -d \
  --name docklet-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DOCKLET_CP=http://<CP-IP>:8080 \
  docklet/agent:latest
```

### 2.2 Проверка регистрации
```bash
curl http://<CP-IP>:8080/api/state/nodes
```
Ожидаемый результат
```json
[
  {
    "node_id": "node-1",
    "status": "online"
  }
]
```

# 3. Установка CLI (User)

### 3.1 Установка
```bash
curl -L https://docklet.io/install.sh | sh
```
### 3.2 Проверка версии
```bash
docklet version
```

# 4. Деплой контейнера (User)

### 4.1 Запуск приложения
```bash
docklet run nginx
```
Ожидаемый результат
```
✔ Creating deployment nginx
✔ Task scheduled
```

### 4.2 Проверка состояния
```bash
docklet ps
```
Ожидаемый результат
```
NAME    DESIRED   ACTUAL    NODE
nginx   running   running   node-1
```

# 5. Проверка реального Docker состояния (Admin)

```bash
docker ps
```
Ожидаемый результат
```
CONTAINER ID   IMAGE    STATUS
abcd1234       nginx    Up
```

# 6. Обновление контейнера (Canary Update)

### 6.1 Запуск обновления
```bash
docklet update nginx --image nginx:1.25
```
Ожидаемый результат
```
🔥 Triggering rollout...
```

### 6.2 Мониторинг
```bash
docklet ps
```
Ожидаемый результат
```
NAME    REVISION   STATUS
nginx   v2         rolling_update
```

# 7. Canary Success Path

### 7.1 Проверка
```bash
docklet ps
```
Ожидаемый результат
```
NAME    DESIRED   ACTUAL   REVISION
nginx   running   running  v2
```

# 8. Canary Failure + Rollback Test

### 8.1 Обновление на несуществующий образ
```bash
docklet update nginx --image nginx:does-not-exist
```

### 8.2 Ожидаемое поведение
```
✖ Canary failed
↩ Rolling back to previous revision
```

### 8.3 Проверка
```bash
docklet ps
```
Ожидаемый результат
```
NAME    DESIRED   ACTUAL   REVISION
nginx   running   running  v2
```

# 9. Crash Test (Advanced)

### 9.1 Убить контейнер вручную
```bash
docker kill <container_id>
```

### 9.2 Проверка Docklet
```bash
docklet ps
```
Ожидаемый результат
```
NAME    DESIRED   ACTUAL
nginx   running   stopped
```

# 10. Recovery Test

### 10.1 Перезапуск Agent
```bash
docker restart docklet-agent
```

### 10.2 Проверка
```bash
docklet ps
```
Ожидаемый результат
```
NAME    DESIRED   ACTUAL
nginx   running   running
```

# 11. Cleanup
```bash
docklet stop nginx
docklet rm nginx
```

✅ Acceptance Criteria
Live test считается успешным, если:

- Агент подключился без ручной настройки
- Контейнер реально запущен Docker’ом
- docklet ps показывает ACTUAL state
- Canary update работает
- Rollback происходит автоматически
- Ошибочный образ не ломает систему
- CP и Agent переживают рестарты

🎯 Итог
Docklet прошёл полный пользовательский путь: install → deploy → update → rollback → recovery

Система готова к прод-использованию.

# Docklet — Testing & Debugging Checklist

## Цель
Проверить корректность работы Docklet как Docker-first orchestrator:
- без дубликатов контейнеров
- без зависших rollout
- с корректным actual state
- с устойчивостью к сбоям

---

# 1. БАЗОВЫЕ ПРОВЕРКИ (SMOKE TESTS)

## 1.1 Control Plane
- [ ] Control Plane стартует без ошибок
- [ ] `GET /api/health` → 200 OK
- [ ] SQLite файл создаётся / открывается
- [ ] Повторный старт CP НЕ ломает состояние

---

## 1.2 Agent
- [ ] Агент стартует без Docker ошибок
- [ ] Агент успешно регистрируется
- [ ] Агент получает `node_id` и token
- [ ] Агент начинает polling `/api/agents/{id}/tasks`
- [ ] Агент отправляет heartbeat каждые N секунд

---

## 1.3 CLI
- [ ] `docklet version` работает
- [ ] `docklet ps` возвращает данные
- [ ] CLI НЕ имеет прямого доступа к БД
- [ ] CLI корректно обрабатывает 4xx / 5xx

---

# 2. TASK / EXECUTOR ТЕСТЫ (КРИТИЧНО)

## 2.1 Deploy Task
- [ ] `docklet run nginx` создаёт Task
- [ ] Task появляется в `/api/agents/{id}/tasks`
- [ ] Agent получает Task
- [ ] Agent выполняет:
  - docker pull
  - docker run
- [ ] Task переходит в `done`
- [ ] CP фиксирует container_id

---

## 2.2 Idempotency
- [ ] Повторный polling НЕ запускает контейнер повторно
- [ ] Agent restart НЕ приводит к повторному deploy
- [ ] Task не может быть выполнен дважды

---

## 2.3 Failure handling
- [ ] Docker pull fail → Task = failed
- [ ] docker run fail → Task = failed
- [ ] Ошибка логируется и возвращается в CP

---

# 3. HEARTBEAT & ACTUAL STATE

## 3.1 Heartbeat
- [ ] Агент отправляет heartbeat регулярно
- [ ] CP обновляет `node.last_seen`
- [ ] Отсутствие heartbeat → node = offline

---

## 3.2 Actual State
- [ ] Agent репортит running контейнеры
- [ ] `/api/state/apps` отражает реальность
- [ ] `docklet ps` показывает ACTUAL state
- [ ] Контейнер убит вручную → состояние обновляется

---

# 4. ROLLOUT ENGINE (v0.2.0)

## 4.1 Update Flow
- [ ] `POST /api/apps/{id}/update` создаёт Revision
- [ ] App.status = rolling_update
- [ ] RolloutController обнаруживает app

---

## 4.2 Canary
- [ ] Canary deploy ТОЛЬКО на 1 ноде
- [ ] Создаётся ровно 1 Task
- [ ] Canary контейнер запускается
- [ ] Heartbeat подтверждает running

---

## 4.3 Success Path
- [ ] Canary OK → Revision = stable
- [ ] App.current_revision обновляется
- [ ] App.status = stable
- [ ] Старая revision деактивирована

---

## 4.4 Failure Path
- [ ] Canary fail → Revision = failed
- [ ] Rollback запускается автоматически
- [ ] Новые контейнеры останавливаются
- [ ] Старая revision остаётся активной
- [ ] App.status = stable

---

## 4.5 Timeouts
- [ ] Canary timeout срабатывает
- [ ] Task stuck в `running` → fail
- [ ] Rollout НЕ зависает бесконечно

---

# 5. CRASH & CHAOS TESTING (ОБЯЗАТЕЛЬНО)

## 5.1 Agent Crash
- [ ] Агент убит во время deploy
- [ ] CP НЕ считает deploy успешным
- [ ] После рестарта агент НЕ дублирует контейнер

---

## 5.2 Control Plane Crash
- [ ] CP убит во время rollout
- [ ] После старта rollout продолжается
- [ ] Состояние консистентно

---

## 5.3 Docker Crash
- [ ] Docker daemon перезапущен
- [ ] Агент корректно восстанавливается
- [ ] CP получает актуальный state

---

# 6. DATA CONSISTENCY

- [ ] Нет orphan containers
- [ ] Нет orphan tasks
- [ ] Нет orphan revisions
- [ ] Desired ≠ Actual → видно в API
- [ ] Нет race condition при polling

---

# 7. LOGGING & DEBUGGING

## 7.1 Control Plane Logs
- [ ] Логируется:
  - создание Task
  - смена статусов
  - rollout transitions
- [ ] Ошибки читаемы и структурированы

---

## 7.2 Agent Logs
- [ ] Логируется:
  - получение Task
  - docker pull/run
  - ошибки Docker
- [ ] Логи помогают понять причину фейла

---

# 8. SECURITY & SAFETY

- [ ] Agent token не логируется
- [ ] CLI не хранит секреты в открытом виде
- [ ] Нет открытых debug endpoints
- [ ] Нет panic в прод коде

---

# 9. PERFORMANCE (SMB SCALE)

- [ ] 20–30 агентов polling не нагружают CP
- [ ] Rollout одного app не блокирует другие
- [ ] SQLite не блокируется надолго

---

# 10. FINAL RELEASE CHECK

Docklet готов к релизу, если:

- [ ] Все пункты выше пройдены
- [ ] Нет известных blocker-багов
- [ ] walkthough.md обновлён
- [ ] CHANGELOG.md написан
- [ ] Версия проставлена (v0.2.0)

---

## ❌ НЕ СЧИТАЕТСЯ ОШИБКОЙ (осознанно)
- Нет autoscaling
- Нет metrics-based rollback
- Нет HA CP
- Нет overlay networking
