// Force NODE_ENV to development so the queue topology names
// (pipeline.<env> + .dlx) match the running local broker, which was
// declared by the dev API/worker. Without this, jest defaults to
// NODE_ENV=test and we'd attempt to redeclare existing step queues
// with a different DLX → PRECONDITION_FAILED from RabbitMQ.
process.env.NODE_ENV = 'development';
