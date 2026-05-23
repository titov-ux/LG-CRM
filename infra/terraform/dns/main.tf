// DNS-зона CRM-LG в Yandex Cloud.
//
// Отдельный модуль / отдельный state — чтобы при `tofu destroy` staging-инфры
// DNS-зона не сносилась (она глобальна на оба контура).
//
// Применение:
//   cd infra/terraform/dns
//   cp terraform.tfvars.example terraform.tfvars
//   $EDITOR terraform.tfvars
//   export YC_TOKEN=$(yc iam create-token)
//   tofu init
//   tofu plan  -out=dns.tfplan
//   tofu apply dns.tfplan
//   tofu output ns_records      # NS-серверы, которые надо прописать в reg.ru

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
  type = string
}

variable "folder_id" {
  type = string
}

variable "zone" {
  type    = string
  default = "ru-central1-a"
}

variable "domain" {
  type        = string
  description = "Корневой домен с точкой в конце, например \"lachevsky.ru.\""
}

variable "staging_subdomain" {
  type        = string
  default     = "staging"
  description = "Поддомен для staging (получится <staging_subdomain>.<domain>)"
}

variable "staging_ip" {
  type        = string
  description = "Публичный IP staging-VM (tofu output public_ip из ../)"
}

variable "prod_ip" {
  type        = string
  default     = ""
  description = "Публичный IP prod-VM. Пока пусто — prod-запись не создаётся."
}

provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = var.zone
}

resource "yandex_dns_zone" "main" {
  name        = replace(trimsuffix(var.domain, "."), ".", "-")
  zone        = var.domain
  public      = true
  description = "DNS-зона CRM-LG (staging + prod), управляется через Terraform"
}

// staging.<domain>
resource "yandex_dns_recordset" "staging_a" {
  zone_id = yandex_dns_zone.main.id
  name    = "${var.staging_subdomain}.${var.domain}"
  type    = "A"
  ttl     = 300
  data    = [var.staging_ip]
}

// prod = корень <domain>. Создаётся только если prod_ip задан.
resource "yandex_dns_recordset" "prod_apex_a" {
  count   = var.prod_ip == "" ? 0 : 1
  zone_id = yandex_dns_zone.main.id
  name    = var.domain
  type    = "A"
  ttl     = 300
  data    = [var.prod_ip]
}

// www.<domain> → тот же prod-IP (через A, чтобы не зависеть от CNAME-ограничений)
resource "yandex_dns_recordset" "prod_www_a" {
  count   = var.prod_ip == "" ? 0 : 1
  zone_id = yandex_dns_zone.main.id
  name    = "www.${var.domain}"
  type    = "A"
  ttl     = 300
  data    = [var.prod_ip]
}

output "dns_zone_id" {
  value = yandex_dns_zone.main.id
}

output "ns_records" {
  value       = ["ns1.yandexcloud.net.", "ns2.yandexcloud.net."]
  description = "Эти NS надо прописать в кабинете регистратора (reg.ru → Изменить DNS-серверы → Свой список)"
}

output "staging_fqdn" {
  value = "${var.staging_subdomain}.${trimsuffix(var.domain, ".")}"
}
