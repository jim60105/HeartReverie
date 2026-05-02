{{/*
Expand the name of the chart.
*/}}
{{- define "heart-reverie.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If the release name contains the chart name it will be
used as the full name as-is.
*/}}
{{- define "heart-reverie.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "heart-reverie.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "heart-reverie.labels" -}}
helm.sh/chart: {{ include "heart-reverie.chart" . }}
{{ include "heart-reverie.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "heart-reverie.selectorLabels" -}}
app.kubernetes.io/name: {{ include "heart-reverie.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Secret name: returns .Values.secret.existingSecret when set, else the
chart-fullname-derived default. Used by the Deployment's envFrom and (when
no existing Secret) by the rendered Secret resource.
*/}}
{{- define "heart-reverie.secretName" -}}
{{- if .Values.secret.existingSecret }}
{{- .Values.secret.existingSecret }}
{{- else }}
{{- printf "%s-secret" (include "heart-reverie.fullname" .) }}
{{- end }}
{{- end }}

{{/*
PVC name: returns .Values.persistence.existingClaim when set, else the
chart-fullname-derived default.
*/}}
{{- define "heart-reverie.pvcName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "heart-reverie.fullname" .) }}
{{- end }}
{{- end }}

{{/*
ServiceAccount name:
  - when .Values.serviceAccount.name is non-empty: that exact name
  - else when .Values.serviceAccount.create is true: the chart fullname
  - else: empty string (Deployment must omit serviceAccountName so the
    namespace's `default` SA is used)
*/}}
{{- define "heart-reverie.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else if .Values.serviceAccount.create }}
{{- include "heart-reverie.fullname" . }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}
