// Terraform-конфиг для staging/prod CRM-LG на Yandex Cloud.
//
// Что создаётся:
//   * Сеть + одна публичная подсеть в выбранной зоне.
//   * Security group с открытыми 22 (SSH), 80, 443.
//   * Compute Instance с Ubuntu 22.04 и cloud-init из cloud-init.yaml.
//   * Два Object Storage бакета (для файлов и для бэкапов БД).
//   * Service Account + статические ключи для S3-доступа.
//
// Перед запуском:
//   yc init && yc iam create-token        // или yc config set token <oauth>
//   terraform init && terraform apply
//
// После apply: terraform output ssh_command — копируем и идём в VM, дальше bootstrap.sh.

terraform {
  required_version = ">= 1.5"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.110"
    }
  }
}

variable "cloud_id" {
  type        = string
  description = "Yandex Cloud ID (yc config get cloud-id)"
}
variable "folder_id" {
  type        = string
  description = "Yandex Cloud folder ID (yc config get folder-id)"
}
variable "zone" {
  type    = string
  default = "ru-central1-a"
}
variable "vm_name" {
  type    = string
  default = "crm-lg-staging"
}
variable "vm_cores" {
  type        = number
  default     = 2
  description = "Минимум 2 vCPU"
}
variable "vm_memory_gb" {
  type    = number
  default = 4
}
variable "vm_disk_gb" {
  type    = number
  default = 60
}
variable "ssh_public_key" {
  type        = string
  description = "Содержимое ~/.ssh/id_ed25519.pub (для входа в VM)"
}
variable "files_bucket" {
  type    = string
  default = "crm-lg-files"
}
variable "backups_bucket" {
  type    = string
  default = "crm-lg-backups"
}
variable "domain" {
  type        = string
  default     = ""
  description = "Доменное имя для прод-DNS (опционально, для информационных outputs)"
}

provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = var.zone
}

// ─────────── Network ───────────
resource "yandex_vpc_network" "main" {
  name = "${var.vm_name}-net"
}

resource "yandex_vpc_subnet" "main" {
  name           = "${var.vm_name}-subnet"
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = ["10.10.0.0/24"]
}

resource "yandex_vpc_security_group" "main" {
  name       = "${var.vm_name}-sg"
  network_id = yandex_vpc_network.main.id

  ingress {
    description    = "SSH"
    protocol       = "TCP"
    port           = 22
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description    = "HTTP (ACME-challenge + редирект)"
    protocol       = "TCP"
    port           = 80
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description    = "HTTPS"
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description    = "All outgoing"
    protocol       = "ANY"
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

// ─────────── Service Account для S3 ───────────
resource "yandex_iam_service_account" "s3" {
  name = "${var.vm_name}-s3-sa"
}

resource "yandex_resourcemanager_folder_iam_member" "storage_editor" {
  folder_id = var.folder_id
  role      = "storage.editor"
  member    = "serviceAccount:${yandex_iam_service_account.s3.id}"
}

resource "yandex_iam_service_account_static_access_key" "s3" {
  service_account_id = yandex_iam_service_account.s3.id
  description        = "Static keys for backups + file uploads"
}

resource "yandex_storage_bucket" "files" {
  bucket     = var.files_bucket
  access_key = yandex_iam_service_account_static_access_key.s3.access_key
  secret_key = yandex_iam_service_account_static_access_key.s3.secret_key
  acl        = "private"
  // CORS — фронт льёт файл напрямую через presigned POST.
  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = var.domain == "" ? ["*"] : ["https://${var.domain}"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "yandex_storage_bucket" "backups" {
  bucket     = var.backups_bucket
  access_key = yandex_iam_service_account_static_access_key.s3.access_key
  secret_key = yandex_iam_service_account_static_access_key.s3.secret_key
  acl        = "private"
}

// ─────────── Compute ───────────
data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

locals {
  cloud_init = templatefile("${path.module}/cloud-init.yaml", {
    ssh_public_key = var.ssh_public_key
  })
}

resource "yandex_compute_instance" "main" {
  name        = var.vm_name
  hostname    = var.vm_name
  zone        = var.zone
  platform_id = "standard-v3"

  resources {
    cores         = var.vm_cores
    memory        = var.vm_memory_gb
    core_fraction = 100
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      size     = var.vm_disk_gb
      type     = "network-ssd"
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.main.id
    nat                = true
    security_group_ids = [yandex_vpc_security_group.main.id]
  }

  metadata = {
    user-data = local.cloud_init
    ssh-keys  = "crm:${var.ssh_public_key}"
  }
}

// ─────────── Outputs ───────────
output "public_ip" {
  value       = yandex_compute_instance.main.network_interface.0.nat_ip_address
  description = "Внешний IP, на него надо направить A-запись домена"
}

output "ssh_command" {
  value = "ssh crm@${yandex_compute_instance.main.network_interface.0.nat_ip_address}"
}

output "s3_access_key" {
  value     = yandex_iam_service_account_static_access_key.s3.access_key
  sensitive = true
}

output "s3_secret_key" {
  value     = yandex_iam_service_account_static_access_key.s3.secret_key
  sensitive = true
}

output "files_bucket" {
  value = yandex_storage_bucket.files.bucket
}

output "backups_bucket" {
  value = yandex_storage_bucket.backups.bucket
}
