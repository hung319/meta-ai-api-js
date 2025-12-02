# Sử dụng Node.js image nhẹ (Alpine version)
FROM node:18-alpine

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy package.json trước để tận dụng Docker layer caching
COPY package.json ./

# Cài đặt dependencies
RUN npm install

# Copy toàn bộ mã nguồn vào container
COPY . .

# Expose port mà ứng dụng chạy (khớp với PORT trong .env hoặc mặc định 3000)
EXPOSE 3000

# Lệnh khởi chạy server
CMD ["npm", "start"]
