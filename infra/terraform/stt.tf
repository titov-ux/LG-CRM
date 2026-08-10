# Опциональная VM под stt-service (Этап 6 AI-скрининга).
#
# По умолчанию STT крутится на основной CRM-VM в docker-compose (CPU, small).
# Если по итогам Этапа 0 нужен GPU (T4) или отдельный CPU-инстанс под нагрузку —
# включите create_stt_vm = true в *.tfvars.
#
# После apply: STT_URL в .env.prod основной VM → ws://<stt_private_ip>:8765
# (или публичный IP, если ходите с другой сети; лучше — private + SG).

variable "create_stt_vm" {
  type        = bool
  default     = false
  description = "Создать отдельную VM для stt-service (GPU/CPU)"
}

variable "stt_vm_name" {
  type    = string
  default = ""
  description = "Имя STT-VM; пусто = ${vm_name}-stt"
}

variable "stt_platform_id" {
  type        = string
  default     = "standard-v3"
  description = "YC platform: standard-v3 (CPU) или gpu-standard-v3 (T4 и т.п.)"
}

variable "stt_gpus" {
  type        = number
  default     = 0
  description = "Число GPU (1 для T4 на gpu-standard-v3; 0 для CPU)"
}

variable "stt_cores" {
  type    = number
  default = 8
}

variable "stt_memory_gb" {
  type    = number
  default = 16
}

variable "stt_disk_gb" {
  type    = number
  default = 100
}

locals {
  stt_vm_name = var.stt_vm_name != "" ? var.stt_vm_name : "${var.vm_name}-stt"
}

resource "yandex_vpc_security_group" "stt" {
  count       = var.create_stt_vm ? 1 : 0
  name        = "${local.stt_vm_name}-sg"
  network_id  = yandex_vpc_network.main.id
  description = "STT: SSH + WS 8765 из SG основной CRM-VM"

  ingress {
    description       = "SSH"
    protocol          = "TCP"
    port              = 22
    v4_cidr_blocks    = ["0.0.0.0/0"]
  }

  ingress {
    description    = "stt-service WS from CRM subnet"
    protocol       = "TCP"
    port           = 8765
    v4_cidr_blocks = yandex_vpc_subnet.main.v4_cidr_blocks
  }

  egress {
    description    = "All outgoing (HF models, apt)"
    protocol       = "ANY"
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_compute_instance" "stt" {
  count       = var.create_stt_vm ? 1 : 0
  name        = local.stt_vm_name
  hostname    = local.stt_vm_name
  zone        = var.zone
  platform_id = var.stt_platform_id

  resources {
    cores         = var.stt_cores
    memory        = var.stt_memory_gb
    gpus          = var.stt_gpus
    core_fraction = 100
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      size     = var.stt_disk_gb
      type     = "network-ssd"
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.main.id
    nat                = true
    security_group_ids = [yandex_vpc_security_group.stt[0].id]
  }

  metadata = {
    user-data = local.cloud_init
    ssh-keys  = "crm:${var.ssh_public_key}"
  }
}

output "stt_public_ip" {
  value       = var.create_stt_vm ? yandex_compute_instance.stt[0].network_interface.0.nat_ip_address : null
  description = "Публичный IP STT-VM (для SSH / bootstrap)"
}

output "stt_private_ip" {
  value       = var.create_stt_vm ? yandex_compute_instance.stt[0].network_interface.0.ip_address : null
  description = "Внутренний IP — для STT_URL=ws://<ip>:8765 с основной VM"
}

output "stt_ssh_command" {
  value = var.create_stt_vm ? "ssh crm@${yandex_compute_instance.stt[0].network_interface.0.nat_ip_address}" : null
}
