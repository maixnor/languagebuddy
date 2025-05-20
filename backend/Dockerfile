FROM denoland/deno:latest

COPY . .

RUN deno cache main.ts

EXPOSE 8000
EXPOSE 3000

CMD ["deno", "run", "--allow-all", "main.ts"]