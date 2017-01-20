# -*- coding: utf-8 -*-
# Generated by Django 1.9.7 on 2017-01-19 22:29
from __future__ import unicode_literals

import contentcuration.models
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('contentcuration', '0044_auto_20170119_1033'),
    ]

    operations = [
        migrations.AddField(
            model_name='contentnode',
            name='original_channel_id',
            field=contentcuration.models.UUIDField(editable=False, max_length=32, null=True),
        ),
        migrations.AddField(
            model_name='contentnode',
            name='source_channel_id',
            field=contentcuration.models.UUIDField(editable=False, max_length=32, null=True),
        ),
    ]
